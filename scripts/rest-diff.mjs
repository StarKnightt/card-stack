// Two resting frames ~1 s apart, mouse off the deck: amplified |difference| heatmap of the deck.
// node scripts/rest-diff.mjs <label>     (headed, real display, off-screen window)
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { BASE_URL, waitUntilSettled } from "./lib/browser.mjs";
import { crop, decode, encode, frameDifference, luminance } from "./lib/image.mjs";

const label = process.argv[2] ?? "rest";
const browser = await chromium.launch({
  headless: false,
  args: [
    "--use-angle=d3d11",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--disable-features=CalculateNativeWinOcclusion",
    "--window-position=-2600,0",
    "--window-size=1600,940",
  ],
});
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto(BASE_URL, { waitUntil: "networkidle" });
await waitUntilSettled(page);
await page.mouse.move(5, 5);
await page.waitForTimeout(1000);

const box = await page.evaluate(() => {
  const r = document.querySelector('[aria-roledescription="poster deck"]').getBoundingClientRect();
  return { x: r.left - 10, y: r.top - 10, w: r.width + 20, h: r.height + 20, ratio: devicePixelRatio };
});
const grab = async () =>
  crop(decode(await page.screenshot()), box.x * box.ratio, box.y * box.ratio, box.w * box.ratio, box.h * box.ratio);
const a = await grab();
await page.waitForTimeout(16);
const b = await grab();
await page.waitForTimeout(1000);
const c = await grab();

const consecutive = frameDifference(luminance(a), luminance(b));
const oneSecond = frameDifference(luminance(a), luminance(c));
// Heatmap: |Δ| × 8, so a 1-level change is visible and per-pixel noise would light up everywhere.
const heat = { width: a.width, height: a.height, data: Buffer.alloc(a.data.length) };
for (let i = 0; i < a.data.length; i += 4) {
  const d = Math.abs(
    0.2126 * (a.data[i] - c.data[i]) + 0.7152 * (a.data[i + 1] - c.data[i + 1]) + 0.0722 * (a.data[i + 2] - c.data[i + 2]),
  );
  const v = Math.min(255, d * 8);
  heat.data[i] = v;
  heat.data[i + 1] = v;
  heat.data[i + 2] = v;
  heat.data[i + 3] = 255;
}
await writeFile(`showcase/diagnostics/${label}-rest-diff-1s-x8.png`, encode(heat));
await writeFile(`showcase/diagnostics/${label}-rest-frame.png`, encode(a));
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(4)]));
console.log(JSON.stringify({ label, consecutiveFrames: round(consecutive), oneSecondApart: round(oneSecond) }, null, 1));
await browser.close();
