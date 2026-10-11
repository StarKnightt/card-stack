// Close-up video of the deck at rest (mouse away), lossless PNG frames magnified 3x with
// nearest-neighbour scaling so any per-pixel shimmer would be obvious.
// node scripts/rest-closeup.mjs <output.mp4>   (headed, real display, off-screen window)
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { BASE_URL, waitUntilSettled } from "./lib/browser.mjs";

const output = path.resolve(process.argv[2] ?? "showcase/videos/rest-closeup.mp4");
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
await page.waitForTimeout(800);
// The boundary between the strips and the front card, where both blur and shimmer showed.
const clip = await page.evaluate(() => {
  const card = document.querySelector('[data-card="0"]').getBoundingClientRect();
  return { x: Math.round(card.left + 40), y: Math.round(card.top - 90), width: 220, height: 180 };
});
const dir = await mkdtemp(path.join(tmpdir(), "rest-closeup-"));
const start = Date.now();
let frames = 0;
while (Date.now() - start < 4000) {
  await writeFile(path.join(dir, `f${String(frames).padStart(4, "0")}.png`), await page.screenshot({ clip }));
  frames++;
}
const fps = frames / ((Date.now() - start) / 1000);
await browser.close();
execFileSync("ffmpeg", [
  "-v", "error", "-y",
  "-framerate", fps.toFixed(2),
  "-i", path.join(dir, "f%04d.png"),
  "-vf", "scale=iw*3:ih*3:flags=neighbor,scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=neighbor,format=yuv420p",
  "-c:v", "libx264", "-preset", "slow", "-crf", "10",
  "-movflags", "+faststart",
  output,
]);
await rm(dir, { recursive: true, force: true });
console.log(JSON.stringify({ output, frames, fps: +fps.toFixed(1), clipCssPx: clip }));
