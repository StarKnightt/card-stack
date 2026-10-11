// Pixel-exact check: is the resting front card's backing store copied 1:1 to the screen?
// node scripts/probe-pixels.mjs [--dsf 1.25]   (no flag: headed on the real display)
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { BASE_URL, waitUntilSettled } from "./lib/browser.mjs";
import { crop, decode, encode, upscale } from "./lib/image.mjs";

const dsfArg = process.argv.indexOf("--dsf");
const dsf = dsfArg > 0 ? Number(process.argv[dsfArg + 1]) : null;
const browser = await chromium.launch({
  headless: dsf !== null,
  args: [
    "--use-angle=d3d11",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--disable-features=CalculateNativeWinOcclusion",
    ...(dsf === null ? ["--window-position=-2600,0"] : [`--force-device-scale-factor=${dsf}`]),
    "--window-size=1600,940",
  ],
});
const context = await browser.newContext({ viewport: null, reducedMotion: "reduce" });
const page = await context.newPage();
page.on("console", (m) => { if (m.text().startsWith("deckRow")) console.log(m.text()); });
await page.goto(BASE_URL, { waitUntil: "networkidle" });
await waitUntilSettled(page);
await page.waitForTimeout(1200);

const info = await page.evaluate(() => {
  const canvas = document.querySelector('[data-card="0"] canvas');
  const r = canvas.getBoundingClientRect();
  const ratio = devicePixelRatio;
  const row = canvas.closest("[data-card]").parentElement.parentElement.getBoundingClientRect();
  console.log("deckRow origin css", row.left, row.top, "device", row.left * ratio, row.top * ratio);
  const w = 200;
  const h = 120;
  const sx = 150;
  const sy = 120;
  const data = canvas.getContext("2d").getImageData(sx, sy, w, h).data;
  return {
    ratio,
    inline: canvas.closest("[data-card]").style.transform,
    origin: [r.left * ratio, r.top * ratio],
    region: { sx, sy, w, h },
    backing: Array.from(data),
  };
});
const shot = decode(await page.screenshot());
const { sx, sy, w, h } = info.region;
const ox = Math.round(info.origin[0]);
const oy = Math.round(info.origin[1]);

let best = null;
for (let dy = -2; dy <= 2; dy++) {
  for (let dx = -2; dx <= 2; dx++) {
    let sum = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const b = (y * w + x) * 4;
        const s = ((oy + sy + y + dy) * shot.width + (ox + sx + x + dx)) * 4;
        for (let c = 0; c < 3; c++) sum += Math.abs(info.backing[b + c] - shot.data[s + c]);
      }
    }
    const mae = sum / (w * h * 3);
    if (!best || mae < best.mae) best = { dx, dy, mae: +mae.toFixed(3) };
  }
}
const lumAt = (data, i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
// Where the compositor actually put the texture: fit screen ≈ backing shifted by (dx + fx, dy + fy).
const bilinear = (u, v) => {
  const i = Math.floor(u);
  const j = Math.floor(v);
  const tx = u - i;
  const ty = v - j;
  const at = (x, y) => lumAt(info.backing, (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4);
  return (1 - ty) * ((1 - tx) * at(i, j) + tx * at(i + 1, j)) + ty * ((1 - tx) * at(i, j + 1) + tx * at(i + 1, j + 1));
};
let fit = null;
for (let oyInt = -1; oyInt <= 1; oyInt++) {
  for (let oxInt = -1; oxInt <= 1; oxInt++) {
    for (let fy = 0; fy < 1; fy += 0.05) {
      for (let fx = 0; fx < 1; fx += 0.05) {
        let sum = 0;
        for (let y = 4; y < h - 4; y += 2) {
          for (let x = 4; x < w - 4; x += 2) {
            const screen = lumAt(shot.data, ((oy + sy + y) * shot.width + (ox + sx + x)) * 4);
            sum += Math.abs(screen - bilinear(x - oxInt - fx, y - oyInt - fy));
          }
        }
        if (!fit || sum < fit.sum) fit = { sum, shift: [+(oxInt + fx).toFixed(2), +(oyInt + fy).toFixed(2)] };
      }
    }
  }
}
console.log("texture shift relative to the rounded origin (device px):", JSON.stringify(fit.shift));

// Residual at the best offset: systematic bias per channel, and whether pixel-scale detail
// (backing minus its 3x3 mean) survives on screen (gain 1 = untouched, 0 = smoothed away).
const bias = [0, 0, 0];
let num = 0;
let den = 0;
const hp = (get, x, y) => {
  let sum = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) sum += get(x + i, y + j);
  return get(x, y) - sum / 9;
};
const backingLum = (x, y) => lumAt(info.backing, (y * w + x) * 4);
const screenLum = (x, y) =>
  lumAt(shot.data, ((oy + sy + y + best.dy) * shot.width + (ox + sx + x + best.dx)) * 4);
for (let y = 1; y < h - 1; y++) {
  for (let x = 1; x < w - 1; x++) {
    const b = (y * w + x) * 4;
    const s = ((oy + sy + y + best.dy) * shot.width + (ox + sx + x + best.dx)) * 4;
    for (let c = 0; c < 3; c++) bias[c] += shot.data[s + c] - info.backing[b + c];
    const hb = hp(backingLum, x, y);
    num += hb * hp(screenLum, x, y);
    den += hb * hb;
  }
}
const n = (w - 2) * (h - 2);
console.log(
  JSON.stringify(
    {
      ratio: info.ratio,
      inline: info.inline,
        origin: info.origin,
      screenshot: [shot.width, shot.height],
      bestMatch: best,
      biasRGB: bias.map((v) => +(v / n).toFixed(3)),
      detailGain: +(num / den).toFixed(3),
    },
    null,
    1,
  ),
);

const screenCrop = crop(shot, ox + sx + best.dx, oy + sy + best.dy, 60, 40);
const backingImage = { width: w, height: h, data: Buffer.from(info.backing) };
const backingCrop = crop(backingImage, 0, 0, 60, 40);
await writeFile("showcase/diagnostics/probe-screen-8x.png", encode(upscale(screenCrop, 8)));
await writeFile("showcase/diagnostics/probe-backing-8x.png", encode(upscale(backingCrop, 8)));
await browser.close();
