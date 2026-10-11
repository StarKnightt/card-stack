// Showcase screenshots and videos: node scripts/capture.mjs [shots|videos]
import { mkdir } from "node:fs/promises";
import { BASE_URL, deckBox, launch, openPage, waitUntilSettled } from "./lib/browser.mjs";
import { showCursor, startRecording } from "./lib/recorder.mjs";

const SHOTS = "showcase/screenshots";
const VIDEOS = "showcase/videos";
const only = process.argv[2];
await mkdir(SHOTS, { recursive: true });
await mkdir(VIDEOS, { recursive: true });

const browser = await launch();
const problems = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const zoneY = (box, zone) => box.top + box.height - ((zone + 0.5) * box.height) / 12;

async function glide(page, from, to, ms, ease = (t) => t) {
  const steps = Math.max(2, Math.round(ms / 16));
  for (let s = 1; s <= steps; s++) {
    const t = ease(s / steps);
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await sleep(ms / steps);
  }
}
const easeInOut = (t) => (1 - Math.cos(Math.PI * t)) / 2;

async function desktop(options = {}) {
  const session = await openPage(browser, { deviceScaleFactor: 2, ...options });
  problems.push(...session.problems);
  return session;
}

async function shots() {
  {
    const { context, page } = await desktop();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/01-idle.png` });

    const box = await deckBox(page);
    const x = box.left + box.width * 0.68;
    await page.mouse.move(x, box.top + box.height + 40);
    await glide(page, { x, y: box.top + box.height - 10 }, { x, y: zoneY(box, 6) + 6 }, 900, easeInOut);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}/02-mid-scrub-hover.png` });
    await page.screenshot({
      path: `${SHOTS}/03-tilt-glare-closeup.png`,
      clip: { x: box.left - 70, y: box.top - 20, width: box.width + 140, height: box.height + 50 },
    });

    await page.mouse.click(x, zoneY(box, 6) + 6);
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${SHOTS}/04-expanded.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
    await context.close();
  }

  {
    // Mid-flip frame: slow page time down and catch a card halfway through its fall.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
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
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__setTimeScale(1 / 14));
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(1250);
    const box = await deckBox(page);
    await page.screenshot({
      path: `${SHOTS}/05-mid-flip.png`,
      clip: { x: box.left - 70, y: box.top - 20, width: box.width + 140, height: box.height + 50 },
    });
    await context.close();
  }

  {
    const { context, page } = await desktop({ reducedMotion: "reduce" });
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}/06-reduced-motion.png` });
    await context.close();
  }

  {
    const { context, page } = await openPage(browser, {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/07-mobile.png` });
    const box = await deckBox(page);
    await page.touchscreen.tap(box.left + box.width / 2, box.top + box.height - 40);
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${SHOTS}/08-mobile-expanded.png` });
    await context.close();
  }
}

async function videos() {
  const videoContext = { deviceScaleFactor: 1 };
  {
    const { context, page } = await openPage(browser, videoContext);
    await showCursor(page);
    const box = await deckBox(page);
    const x = box.left + box.width * 0.62;
    await page.mouse.move(box.left + box.width + 220, box.top + box.height + 80);
    const recording = await startRecording(page);
    await sleep(700);
    await glide(page, { x: box.left + box.width + 220, y: box.top + box.height + 80 }, { x, y: box.top + box.height - 12 }, 700, easeInOut);
    await glide(page, { x, y: box.top + box.height - 12 }, { x: x - 30, y: box.top + 10 }, 4200, easeInOut);
    await sleep(500);
    await glide(page, { x: x - 30, y: box.top + 10 }, { x, y: box.top + box.height - 12 }, 4200, easeInOut);
    await sleep(800);
    await recording.stop(`${VIDEOS}/01-hover-scrub-slow.mp4`);

    const rapid = await startRecording(page);
    for (let pass = 0; pass < 4; pass++) {
      const [a, b] = pass % 2 ? [box.top + 12, box.top + box.height - 12] : [box.top + box.height - 12, box.top + 12];
      await glide(page, { x, y: a }, { x: x + (pass % 2 ? 20 : -20), y: b }, 420);
    }
    await glide(page, { x, y: box.top + box.height - 12 }, { x, y: zoneY(box, 5) }, 300);
    await sleep(1200);
    await rapid.stop(`${VIDEOS}/02-hover-scrub-rapid.mp4`);

    await page.mouse.move(box.left + box.width + 260, box.top + box.height / 2, { steps: 10 });
    const wheel = await startRecording(page);
    await sleep(400);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 100);
      await sleep(260);
    }
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, -100);
      await sleep(260);
    }
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowUp");
      await sleep(320);
    }
    await page.keyboard.press("End");
    await sleep(900);
    await page.keyboard.press("Home");
    await sleep(1100);
    await wheel.stop(`${VIDEOS}/03-wheel-and-keys.mp4`);

    const expand = await startRecording(page);
    const target = { x: box.left + box.width * 0.55, y: zoneY(box, 3) };
    await glide(page, { x: box.left + box.width + 260, y: box.top + box.height / 2 }, target, 900, easeInOut);
    await sleep(500);
    await page.mouse.click(target.x, target.y);
    await sleep(1800);
    await page.mouse.move(720, 420, { steps: 12 });
    await page.mouse.click(720, 420);
    await sleep(1300);
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await sleep(400);
    await page.keyboard.press("Enter");
    await sleep(1500);
    await page.keyboard.press("Escape");
    await sleep(1300);
    await expand.stop(`${VIDEOS}/04-expand-collapse.mp4`);
    await context.close();
  }

  {
    const { context, page } = await openPage(browser, {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const cdp = await context.newCDPSession(page);
    const box = await deckBox(page);
    const x = box.left + box.width / 2;
    const swipe = async (from, to, ms) => {
      const steps = Math.round(ms / 16);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
      for (let s = 1; s <= steps; s++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: from + ((to - from) * s) / steps }],
        });
        await sleep(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const recording = await startRecording(page);
    await sleep(600);
    await swipe(box.top + box.height - 30, box.top + box.height - 150, 360);
    await sleep(900);
    await swipe(box.top + box.height - 30, box.top + box.height - 90, 120);
    await sleep(900);
    await swipe(box.top + 120, box.top + 260, 300);
    await sleep(900);
    await page.touchscreen.tap(x, box.top + box.height - 60);
    await sleep(1600);
    await page.touchscreen.tap(x, 300);
    await sleep(1300);
    await recording.stop(`${VIDEOS}/05-mobile-swipe-tap.mp4`);
    await context.close();
  }
}

if (!only || only === "shots") await shots();
if (!only || only === "videos") await videos();
await browser.close();
console.log(problems.length ? problems.join("\n") : "no console problems");
