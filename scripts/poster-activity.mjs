// How much each poster changes per second as the resting front card (mean |Δ| luminance, 0–255).
import { chromium } from "playwright";
import { BASE_URL, waitUntilSettled } from "./lib/browser.mjs";
import { crop, decode, frameDifference, luminance } from "./lib/image.mjs";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--window-size=1600,940"],
});
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto(BASE_URL, { waitUntil: "networkidle" });
await waitUntilSettled(page);
await page.mouse.move(5, 5);
const titles = await page.evaluate(() => [...document.querySelectorAll("nav button")].map((b) => b.getAttribute("aria-label").split(",")[0]));
for (let i = 0; i < 12; i++) {
  if (i > 0) await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(900);
  const r = await page.evaluate((index) => {
    const box = document.querySelector(`[data-card="${index}"]`).getBoundingClientRect();
    return { x: box.left + 12, y: box.top + 12, w: box.width - 24, h: box.height - 24 };
  }, i);
  const grab = async () => luminance(crop(decode(await page.screenshot()), r.x, r.y, r.w, r.h));
  // Short interval, so a moving feature hasn't left its own footprint and Δ stays proportional to speed.
  const start = Date.now();
  const a = await grab();
  await page.waitForTimeout(120);
  const b = await grab();
  const seconds = (Date.now() - start) / 1000 / 1.5;
  const d = frameDifference(a, b);
  console.log(`${String(i).padStart(2)} ${titles[i].padEnd(14)} mean|Δ| per s ${(d.meanAbs / seconds).toFixed(2).padStart(6)}  fine-detail Δ per s ${(d.flicker / seconds).toFixed(2).padStart(6)}`);
}
await browser.close();
