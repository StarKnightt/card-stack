// Frame-by-frame review of transitions: slows page time (springs, shaders) and tiles frames.
// node scripts/slowmo.mjs
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { BASE_URL, deckBox, launch, waitUntilSettled } from "./lib/browser.mjs";

const out = "showcase/scratch/slowmo";
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  const realNow = performance.now.bind(performance);
  let scale = 1;
  let base = realNow();
  let virtual = base;
  const now = () => {
    const real = realNow();
    virtual += (real - base) * scale;
    base = real;
    return virtual;
  };
  window.__setTimeScale = (value) => {
    now();
    scale = value;
  };
  performance.now = now;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => raf(() => callback(now()));
});
const page = await context.newPage();
await page.goto(BASE_URL, { waitUntil: "networkidle" });
await waitUntilSettled(page);
const box = await deckBox(page);
const clip = { x: box.left - 60, y: box.top - 30, width: box.width + 120, height: box.height + 70 };

async function sequence(name, setup, action, frames = 20, gap = 90) {
  const dir = `${out}/${name}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => window.__setTimeScale(1));
  await setup();
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__setTimeScale(1 / 12));
  await action();
  for (let f = 0; f < frames; f++) {
    await page.screenshot({ path: `${dir}/${String(f).padStart(2, "0")}.png`, clip });
    await page.waitForTimeout(gap);
  }
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-i", `${dir}/%02d.png`,
    "-vf", "scale=270:-1,tile=5x4:padding=6:margin=6:color=0xf7f6f3",
    "-frames:v", "1", `${out}/${name}.png`,
  ]);
}

const press = (key, times = 1) => async () => {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
};

const only = process.argv[2]?.split(",");
const run = (name, ...args) =>
  !only || only.some((prefix) => name.startsWith(prefix)) ? sequence(name, ...args) : null;

await run("step-up-3-to-4", async () => {
  await press("Home")();
  await press("ArrowUp", 3)();
}, press("ArrowUp"));
await run("step-down-4-to-3", async () => {}, press("ArrowDown"));
await run("jump-0-to-11", press("Home"), press("End"), 20, 110);

const full = { x: 0, y: 0, width: 1440, height: 900 };
clip.x = full.x;
clip.y = full.y;
clip.width = full.width;
clip.height = full.height;
await run(
  "expand",
  async () => {
    await press("Home")();
    await press("ArrowUp", 4)();
    await page.mouse.move(box.left + box.width * 0.7, box.top + (11 - 4) * 16 + 90);
  },
  () => page.mouse.click(box.left + box.width * 0.7, box.top + (11 - 4) * 16 + 90),
  20,
  110,
);
await run("collapse", async () => {}, press("Escape"), 20, 90);
await browser.close();
console.log("frames in", out);
