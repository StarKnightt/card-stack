// Measures why cards look soft or shimmer, on the real display or at an emulated DPR.
// node scripts/diagnose-crispness.mjs <label> [--headed | --dpr 1.25]
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { BASE_URL, waitUntilSettled } from "./lib/browser.mjs";
import { crop, decode, encode, frameDifference, highFrequency, luminance, upscale } from "./lib/image.mjs";

const label = process.argv[2] ?? "run";
const headed = process.argv.includes("--headed");
// --dsf runs the real device-scale path (like a Windows display at that scaling);
// Playwright's deviceScaleFactor emulation snaps layout differently and isn't representative.
const dsfArg = process.argv.indexOf("--dsf");
const dsf = dsfArg > 0 ? Number(process.argv[dsfArg + 1]) : undefined;
const out = path.join("showcase", "diagnostics", label);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  headless: !headed,
  args: [
    "--use-angle=d3d11",
    "--enable-gpu",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--disable-features=CalculateNativeWinOcclusion",
    // Off-screen, so the user's real cursor can't hover it; Windows still renders it at
    // the primary display's DPI and refresh rate.
    ...(headed ? ["--window-position=-2600,0"] : []),
    ...(dsf ? [`--force-device-scale-factor=${dsf}`] : []),
    "--window-size=1600,940",
  ],
});

async function open({ reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport: null, reducedMotion });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await waitUntilSettled(page);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(900);
  return { context, page };
}

const geometry = (page) =>
  page.evaluate(() => {
    const ratio = window.devicePixelRatio;
    const active = Number(document.querySelector("[data-active-index]").dataset.activeIndex);
    const cards = [...document.querySelectorAll("[data-card]")].map((card) => {
      const canvas = card.querySelector("canvas");
      const r = canvas.getBoundingClientRect();
      return {
        index: Number(card.dataset.card),
        backing: [canvas.width, canvas.height],
        displayedDevicePx: [+(r.width * ratio).toFixed(3), +(r.height * ratio).toFixed(3)],
        originDevicePx: [+(r.left * ratio).toFixed(3), +(r.top * ratio).toFixed(3)],
        transform: getComputedStyle(card).transform,
      };
    });
    const hit = document.querySelector('[aria-roledescription="poster deck"]').getBoundingClientRect();
    return {
      devicePixelRatio: ratio,
      viewport: [innerWidth, innerHeight],
      deckZoom: +(hit.width / 420).toFixed(4),
      active,
      untouched: active === 0,
      activeCard: cards.find((c) => c.index === active),
      backCards: cards.filter((c) => c.index !== active).map((c) => ({ index: c.index, backing: c.backing })),
    };
  });

/** Screenshot pixels vs the canvas backing store for the same (frozen) frame. */
async function sharpness(page) {
  const { rect, backing, ratio } = await page.evaluate(() => {
    const index = document.querySelector("[data-active-index]").dataset.activeIndex;
    const canvas = document.querySelector(`[data-card="${index}"] canvas`);
    const r = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    const inset = 0.08;
    const sx = Math.round(canvas.width * inset);
    const sy = Math.round(canvas.height * inset);
    const w = Math.round(canvas.width * (1 - 2 * inset));
    const h = Math.round(canvas.height * (1 - 2 * inset));
    const pixels = ctx.getImageData(sx, sy, w, h).data;
    let lum = [];
    for (let i = 0; i < pixels.length; i += 4) {
      lum.push(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
    }
    return {
      rect: { x: r.left + r.width * inset, y: r.top + r.height * inset, w: r.width * (1 - 2 * inset), h: r.height * (1 - 2 * inset) },
      backing: { width: w, height: h, lum },
      ratio: window.devicePixelRatio,
    };
  });
  const shot = decode(await page.screenshot({ fullPage: false }));
  const screen = luminance(crop(shot, rect.x * ratio, rect.y * ratio, rect.w * ratio, rect.h * ratio));
  const source = highFrequency({ width: backing.width, height: backing.height, lum: Float32Array.from(backing.lum) });
  const shown = highFrequency(screen);
  return { backingDetail: +source.toFixed(3), screenDetail: +shown.toFixed(3), ratio: +(shown / source).toFixed(3) };
}

async function crops(page, name) {
  const box = await page.evaluate(() => {
    const index = document.querySelector("[data-active-index]").dataset.activeIndex;
    const r = document.querySelector(`[data-card="${index}"]`).getBoundingClientRect();
    const hit = document.querySelector('[aria-roledescription="poster deck"]').getBoundingClientRect();
    return { card: { x: r.left, y: r.top, w: r.width, h: r.height }, deck: { x: hit.left, y: hit.top, w: hit.width } };
  });
  const ratio = await page.evaluate(() => window.devicePixelRatio);
  const shot = decode(await page.screenshot());
  const s = (v) => v * ratio;
  // Sun edge on the front card, and the strips just above it.
  const front = crop(shot, s(box.card.x + box.card.w * 0.18), s(box.card.y + box.card.h * 0.4), s(150), s(95));
  const strips = crop(shot, s(box.deck.x + 30), s(box.card.y - 70), s(150), s(80));
  await writeFile(path.join(out, `${name}-front-4x.png`), encode(upscale(front, 4)));
  await writeFile(path.join(out, `${name}-strips-4x.png`), encode(upscale(strips, 4)));
}

/** Consecutive screenshots of the deck at rest: what changes between frames. */
async function restFlicker(page) {
  const box = await page.evaluate(() => {
    const index = document.querySelector("[data-active-index]").dataset.activeIndex;
    const r = document.querySelector(`[data-card="${index}"]`).getBoundingClientRect();
    return { x: r.left + 20, y: r.top + 20, w: r.width - 40, h: r.height - 40 };
  });
  const ratio = await page.evaluate(() => window.devicePixelRatio);
  const frames = [];
  for (let i = 0; i < 6; i++) {
    const shot = decode(await page.screenshot());
    frames.push(luminance(crop(shot, box.x * ratio, box.y * ratio, box.w * ratio, box.h * ratio)));
  }
  const pairs = [];
  for (let i = 1; i < frames.length; i++) pairs.push(frameDifference(frames[i - 1], frames[i]));
  const avg = (key) => +(pairs.reduce((sum, p) => sum + p[key], 0) / pairs.length).toFixed(4);
  return { meanAbsDelta: avg("meanAbs"), changedShare: avg("changedShare"), flicker: avg("flicker") };
}

/** Does anything other than the canvases keep changing with the mouse away? */
async function restMutations(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        let mutations = 0;
        const observer = new MutationObserver((list) => {
          mutations += list.length;
        });
        for (const el of document.querySelectorAll("[data-card], [data-card] *, section *")) {
          if (el.tagName !== "CANVAS") observer.observe(el, { attributes: true, attributeFilter: ["style"] });
        }
        setTimeout(() => {
          observer.disconnect();
          resolve(mutations);
        }, 2500);
      }),
  );
}

const report = { label, mode: headed ? "headed, real display" : `headless, device scale ${dsf ?? 1}` };
{
  const { context, page } = await open();
  report.geometry = await geometry(page);
  report.restStyleMutations2500ms = await restMutations(page);
  report.restFlicker = await restFlicker(page);
  await crops(page, "live");
  await context.close();
}
{
  const { context, page } = await open({ reducedMotion: "reduce" });
  report.sharpnessFrozen = await sharpness(page);
  await crops(page, "frozen");
  await context.close();
}
await browser.close();
await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
