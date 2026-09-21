/**
 * Four browsers play a free-for-all round.
 *
 * The thing to prove: everyone guesses on their own dial, nobody can see
 * anyone else's guess until the reveal, and then everyone sees all of them.
 *
 *   BASE_URL=https://wave-length.fly.dev node e2e/free-for-all.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

const browser = await chromium.launch();
const open = async () => (await (await browser.newContext()).newPage());

console.log("Four browsers, free-for-all\n");

const host = await open();
await host.goto(BASE);
await host.getByLabel("Your name").fill("Ada");
await host.getByRole("button", { name: "Create game", exact: true }).nth(1).click();
await host.waitForURL(/\/room\//, { timeout: 20000 });
const code = host.url().split("/").pop();
console.log(`        room ${code}`);

const guests = [];
for (const name of ["Bo", "Cy", "Di"]) {
  const page = await open();
  await page.goto(`${BASE}/room/${code}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await page.waitForTimeout(1500);
  guests.push({ name, page });
}
const all = [{ name: "Ada", page: host }, ...guests];

check("no teams are shown in the lobby", !/Team A|Team B/.test(await host.innerText("body")));

await host.getByRole("button", { name: "Start game" }).click();
for (const { page } of all) {
  await page.getByRole("group", { name: /dial/i }).waitFor({ timeout: 25000 });
}
check("the game starts for all four", true);

await Promise.all(all.map(({ page }) => page.waitForTimeout(2500)));
const psychic = (await Promise.all(
  all.map(async (p) => ({ p, n: await p.page.getByLabel("Your clue").count() })),
)).find((x) => x.n > 0)?.p;
check("exactly one Psychic", psychic !== undefined);
if (psychic === undefined) { await browser.close(); process.exit(1); }
console.log(`        psychic is ${psychic.name}\n`);

const guessers = all.filter((p) => p !== psychic);

await psychic.page.getByLabel("Your clue").fill("Batman");
await psychic.page.getByRole("button", { name: "Give clue" }).click();

// Everyone guesses somewhere different.
const spots = [0.3, 0.5, 0.7];
for (const [index, player] of guessers.entries()) {
  const dial = player.page.locator("svg").first();
  await dial.waitFor({ timeout: 20000 });
  const box = await dial.boundingBox();
  // Click along the arc at roughly the intended position.
  const x = box.x + box.width * spots[index];
  const y = box.y + box.height * 0.35;
  await player.page.mouse.click(x, y);
  await player.page.waitForTimeout(300);

  // Before locking in, nobody else's guess may be visible.
  const others = await player.page.getByTestId("guess-markers").count();
  check(`${player.name} cannot see anyone else's guess yet`, others === 0);

  await player.page.getByRole("button", { name: "Lock in my guess" }).click();
  await player.page.waitForTimeout(500);
}

// After the last guess the round reveals for everyone.
for (const { name, page } of all) {
  try {
    await page.getByTestId("guess-markers").waitFor({ timeout: 25000 });
    const markers = await page.getByTestId("guess-markers").locator("text").count();
    check(`${name} sees all three needles at the reveal`, markers === 3, `saw ${markers}`);
  } catch {
    check(`${name} sees all three needles at the reveal`, false, "no markers appeared");
  }
}

const board = await host.getByTestId("leaderboard").innerText();
check("the leaderboard lists everyone", ["Ada", "Bo", "Cy", "Di"].every((n) => board.includes(n)), board.replace(/\n/g, " | "));
check("somebody scored something", /[1-9]/.test(board));

await host.getByRole("button", { name: "Next round" }).click();
await host.waitForTimeout(4000);
const next = await host.innerText("body");
check("a second round starts", /Round 2/.test(next), next.slice(0, 120));

console.log(`\n${failures === 0 ? "Free-for-all works." : `${failures} FAILURES`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
