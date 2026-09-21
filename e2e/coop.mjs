/**
 * Play a two-player co-op round in real browsers against a live deployment.
 *
 * The thing to prove: with nobody to call left or right, the round still
 * reaches a reveal and scores — rather than hanging in the prediction phase
 * waiting for a call that is never coming.
 *
 *   BASE_URL=https://wave-length.fly.dev node e2e/coop.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

const browser = await chromium.launch();
const mk = async () => (await (await browser.newContext()).newPage());

console.log("Two players, co-op\n");

const host = await mk();
await host.goto(BASE);
await host.getByLabel("Your name").fill("Ada");
await host.getByRole("button", { name: "Create game", exact: true }).nth(1).click();
await host.waitForURL(/\/room\//, { timeout: 20000 });
const code = host.url().split("/").pop();
console.log(`        room ${code}`);

const guest = await mk();
await guest.goto(`${BASE}/room/${code}`);
await guest.getByLabel("Your name").fill("Bo");
await guest.getByRole("button", { name: "Join", exact: true }).click();
await guest.waitForTimeout(2500);

// Both should be on one side, and the lobby should say so.
const blurb = await host.innerText("body");
check("the lobby offers co-op with two players", /co-op/i.test(blurb), blurb.slice(0, 120));

const startBtn = host.getByRole("button", { name: /Start co-op game|Start game/ });
check("start is enabled with only two players", await startBtn.isEnabled());
await startBtn.click();

for (const [name, page] of [["Ada", host], ["Bo", guest]]) {
  try {
    await page.getByRole("group", { name: /dial/i }).waitFor({ timeout: 25000 });
    check(`${name} sees the dial`, true);
  } catch {
    check(`${name} sees the dial`, false, "timed out");
  }
}

// Whoever has the clue box is the Psychic; the other moves the needle.
const psychic = (await host.getByLabel("Your clue").count()) > 0 ? host : guest;
const guesser = psychic === host ? guest : host;
check("exactly one of them is the Psychic", (await guesser.getByLabel("Your clue").count()) === 0);

// The Psychic can see the target; the guesser must not. The Psychic's copy is
// fetched after hydration, so wait for it rather than racing the request.
let psychicSees = true;
try {
  await psychic.getByTestId("target-wedges").waitFor({ timeout: 15000 });
} catch {
  psychicSees = false;
}
check("the Psychic sees the target band", psychicSees);
check("the guesser does not", (await guesser.getByTestId("target-wedges").count()) === 0);

await psychic.getByLabel("Your clue").fill("Batman");
await psychic.getByRole("button", { name: "Give clue" }).click();
await guesser.getByText(/Batman/).waitFor({ timeout: 20000 });
check("the clue reaches the guesser", true);

await guesser.getByRole("button", { name: "Lock it in" }).waitFor({ timeout: 20000 });
await guesser.getByRole("button", { name: "Lock it in" }).click();

// The moment of truth: no left/right call exists, so this must reveal anyway.
let revealed = true;
try {
  await Promise.all([
    psychic.getByTestId("round-result").or(psychic.getByText(/Next round/)).waitFor({ timeout: 25000 }),
    guesser.getByText(/Next round/).waitFor({ timeout: 25000 }),
  ]);
} catch {
  revealed = false;
}
check("the round reveals with no left/right call", revealed);

const body = await guesser.innerText("body");
check("no left/right result is shown", !/called (left|right)/i.test(body));
check("a score is shown", /\+\d/.test(body), body.slice(0, 160));

await guesser.getByRole("button", { name: "Next round" }).click();
await guesser.waitForTimeout(4000);
const second = await guesser.innerText("body");
check("a second round starts", /Round 2|looking at the target|Your clue/i.test(second), second.slice(0, 140));

console.log(`\n${failures === 0 ? "Co-op works." : `${failures} FAILURES`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
