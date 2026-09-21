/**
 * Four real browsers play a round, and the three non-Psychics are searched for
 * the target through every channel a cheater could reach.
 *
 * This is the regression guard for requirement #11. The day someone adds
 * target_center to `rounds` "just for debugging", this fails.
 *
 *   ./scripts/dev-stack.sh    (terminal 1)
 *   pnpm dev                  (terminal 2)
 *   node e2e/no-target-leak.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

const browser = await chromium.launch();

/** One player in their own browser context, recording everything they receive. */
async function openPlayer(name) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();

  const seen = { responses: [], sockets: [] };

  page.on("response", async (response) => {
    try {
      const type = response.headers()["content-type"] ?? "";
      if (!type.includes("json") && !type.includes("text")) return;
      seen.responses.push(await response.text());
    } catch {
      // Redirects and aborted requests have no body; nothing to record.
    }
  });

  page.on("websocket", (socket) => {
    socket.on("framereceived", (frame) => seen.sockets.push(String(frame.payload)));
    socket.on("framesent", (frame) => seen.sockets.push(String(frame.payload)));
  });

  return { name, context, page, seen };
}

const fill = async (page, label, value) => page.getByLabel(label).fill(value);

console.log("Four browsers, one round\n");

// --- create and join --------------------------------------------------------
const host = await openPlayer("Ada");
await host.page.goto(BASE);
await fill(host.page, "Your name", "Ada");
await host.page.getByRole("button", { name: "Create game", exact: true }).nth(1).click();
await host.page.waitForURL(/\/room\/[A-Z0-9]{6}/, { timeout: 15000 });

const code = host.page.url().split("/").pop();
console.log(`        room ${code}\n`);

const guests = [];
for (const name of ["Alan", "Bo", "Bea"]) {
  const player = await openPlayer(name);
  await player.page.goto(`${BASE}/room/${code}`);
  await fill(player.page, "Your name", name);
  await player.page.getByRole("button", { name: "Join", exact: true }).click();
  await player.page.getByText(name, { exact: true }).first().waitFor({ timeout: 15000 });
  guests.push(player);
}
const all = [host, ...guests];
check("four players are in the lobby", true);

// --- start ------------------------------------------------------------------
await host.page.getByRole("button", { name: "Start game" }).click();
for (const player of all) {
  await player.page.getByRole("group", { name: /dial/i }).waitFor({ timeout: 20000 });
}
check("the game starts for everyone", true);

// --- who is the Psychic? ----------------------------------------------------
await Promise.all(all.map((p) => p.page.waitForTimeout(3000)));
let psychic = null;
for (const player of all) {
  const isPsychic = await player.page.getByLabel("Your clue").count().catch(() => 0);
  if (isPsychic > 0) psychic = player;
}
check("exactly one Psychic", psychic !== null, "nobody was shown the clue box");
if (psychic === null) {
  await browser.close();
  process.exit(1);
}
console.log(`        psychic is ${psychic.name}\n`);

const others = all.filter((p) => p !== psychic);

// --- the secret -------------------------------------------------------------
// Read it out of the Psychic's own network traffic. That is legitimate: they
// are entitled to it. Everyone else is then searched for this exact value.
const psychicTarget = (() => {
  for (const body of psychic.seen.responses) {
    const match = body.match(/"targetCenter":([0-9.]+)/);
    if (match !== null) return match[1];
  }
  return null;
})();

check("the Psychic received a target", psychicTarget !== null, "no targetCenter in their traffic");
if (psychicTarget === null) {
  await browser.close();
  process.exit(1);
}
console.log(`        target ${psychicTarget}\n`);

// --- the sweep --------------------------------------------------------------
for (const player of others) {
  const page = player.page;

  const html = await page.content();
  check(`${player.name}: target not in the page HTML`, !html.includes(psychicTarget));

  const inResponses = player.seen.responses.some((b) => b.includes(psychicTarget));
  check(`${player.name}: target not in any response body`, !inResponses);

  const inSockets = player.seen.sockets.some((f) => f.includes(psychicTarget));
  check(`${player.name}: target not in any WebSocket frame`, !inSockets);

  const inStorage = await page.evaluate(() =>
    JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }),
  );
  check(`${player.name}: target not in local or session storage`, !inStorage.includes(psychicTarget));

  const wedges = await page.getByTestId("target-wedges").count();
  check(`${player.name}: the target band is not rendered at all`, wedges === 0);

  const denied = await page.evaluate(async () => {
    const roundId = document.querySelector("[data-round-id]")?.getAttribute("data-round-id");
    if (roundId === null || roundId === undefined) return "no-round-id";
    const res = await fetch(`/api/rounds/${roundId}/target`);
    return String(res.status);
  });
  if (denied !== "no-round-id") {
    check(`${player.name}: the target endpoint refuses them`, denied === "403", `got ${denied}`);
  }

  const inReactTree = await page.evaluate((needle) => {
    const walk = (node, depth) => {
      if (node === null || node === undefined || depth > 40) return false;
      for (const key of ["memoizedProps", "memoizedState", "pendingProps"]) {
        try {
          if (JSON.stringify(node[key] ?? null)?.includes(needle)) return true;
        } catch {
          /* circular or non-serialisable; nothing readable here anyway */
        }
      }
      return walk(node.child, depth + 1) || walk(node.sibling, depth + 1);
    };
    const root = document.getElementById("__next") ?? document.body;
    const fiberKey = Object.keys(root).find((k) => k.startsWith("__reactFiber$"));
    return fiberKey === undefined ? false : walk(root[fiberKey], 0);
  }, psychicTarget);
  check(`${player.name}: target not reachable in the React tree`, inReactTree === false);
}

console.log(`\n${failures === 0 ? "No leaks found." : `${failures} FAILURES`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
