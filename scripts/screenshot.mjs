/**
 * Drive the single-device game in a real browser and capture each phase.
 *
 * Catches the things unit tests cannot: layout at 375px, whether the reveal
 * actually looks like a reveal, and whether anything overflows.
 *
 *   pnpm dev
 *   node scripts/screenshot.mjs ./shots
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const OUT = process.argv[2] ?? "./shots";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function shoot(name, width, height, steps) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/local`, { waitUntil: "networkidle" });
  await steps(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await page.close();
  console.log(`  ${name}.png`);
}

const startGame = async (page) => {
  await page.getByRole("button", { name: "Start game" }).click();
  await page.waitForTimeout(400);
};

const toClue = async (page) => {
  await startGame(page);
  await page.getByRole("button", { name: /Show me the target/ }).click();
  await page.waitForTimeout(900); // let the shutters finish swinging
};

const toGuess = async (page) => {
  await toClue(page);
  await page.getByLabel("Your clue").fill("Batman");
  await page.getByRole("button", { name: "Give clue" }).click();
  await page.waitForTimeout(900);
};

const toReveal = async (page) => {
  await toGuess(page);
  await page.getByRole("button", { name: "Lock it in" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /^left$/i }).click();
  await page.waitForTimeout(1200);
};

console.log("Capturing:");
await shoot("setup-desktop", 1280, 900, async () => {});
await shoot("psychic-desktop", 1280, 900, toClue);
await shoot("guess-desktop", 1280, 900, toGuess);
await shoot("reveal-desktop", 1280, 900, toReveal);
await shoot("guess-mobile", 375, 780, toGuess);
await shoot("reveal-mobile", 375, 780, toReveal);

await browser.close();
console.log(`\nWrote to ${OUT}`);
