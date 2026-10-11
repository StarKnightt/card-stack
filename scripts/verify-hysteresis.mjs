// Verifies the hover dead zone: node scripts/verify-hysteresis.mjs
// - parks the mouse exactly on zone boundaries and wiggles it ±1–4 px: zero index changes allowed
// - slow continuous passes over the whole deck: every card activates exactly once per pass
// - fast sweeps: the index jumps straight to the target
// Records the boundary-wiggle test (and the slow passes) to showcase/videos.
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { BASE_URL, deckBox, launch, waitUntilSettled } from "./lib/browser.mjs";

const COUNT = 12;
const VIDEO_DIR = path.resolve("showcase/videos");
const RAW_DIR = path.join(VIDEO_DIR, "raw");
const VIEWPORT = { width: 1440, height: 900 };

let seed = 20261011;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures.push(message);
};

/** Test-only overlay: Playwright videos don't show the cursor, so draw it, plus zone lines and a HUD. */
async function installProbe(page) {
  await page.evaluate((count) => {
    const stage = document.querySelector("[data-active-index]");
    const hit = document.querySelector('[aria-roledescription="poster deck"]');
    const r = hit.getBoundingClientRect();
    window.__changes = [];
    window.__mark = 0;
    window.__target = null;
    stage.addEventListener("cardchange", (event) => {
      window.__changes.push({
        t: performance.now(),
        index: event.detail.index,
        previous: event.detail.previous,
        y: window.__mouse?.[1] ?? null,
      });
    });

    const layer = document.createElement("div");
    layer.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:500 12px/1.5 ui-monospace,Consolas,monospace;color:#17161b";
    for (let k = 1; k < count; k++) {
      const line = document.createElement("div");
      line.dataset.boundary = String(k);
      line.style.cssText = `position:absolute;left:${r.left - 56}px;width:${r.width + 112}px;top:${r.bottom - (k * r.height) / count}px;border-top:1px dashed rgba(230,0,90,.35)`;
      const tag = document.createElement("span");
      tag.textContent = `${k - 1}|${k}`;
      tag.style.cssText = "position:absolute;left:-2px;top:-9px;font-size:10px;color:rgba(230,0,90,.7)";
      line.append(tag);
      layer.append(line);
    }
    const dot = document.createElement("div");
    dot.style.cssText =
      "position:absolute;left:-7px;top:-7px;width:14px;height:14px;border-radius:50%;background:rgba(230,0,90,.9);box-shadow:0 0 0 2px #fff,0 2px 8px rgba(0,0,0,.35);will-change:transform";
    const hud = document.createElement("pre");
    hud.style.cssText =
      "position:absolute;left:24px;top:24px;margin:0;padding:12px 14px;border-radius:10px;background:rgba(255,255,255,.86);box-shadow:0 6px 24px rgba(0,0,0,.08);min-width:300px";
    layer.append(dot, hud);
    document.body.append(layer);

    // Capture-phase pointermove on window runs before the deck's own handler sees the event.
    window.addEventListener(
      "pointermove",
      (event) => {
        window.__mouse = [event.clientX, event.clientY];
        dot.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      },
      { capture: true, passive: true },
    );
    const lines = [...layer.querySelectorAll("[data-boundary]")];
    const tick = () => {
      const target = window.__target;
      for (const line of lines) {
        const on = target && Number(line.dataset.boundary) === target.boundary;
        line.style.borderTopColor = on ? "rgba(230,0,90,.95)" : "rgba(230,0,90,.35)";
        line.style.borderTopStyle = on ? "solid" : "dashed";
      }
      const changes = window.__changes.length - window.__mark;
      const offset = target && window.__mouse ? window.__mouse[1] - target.y : null;
      hud.textContent = [
        window.__title ?? "",
        `active card      ${stage.dataset.activeIndex}`,
        `index changes    ${changes}${target ? "  (must stay 0)" : ""}`,
        offset === null ? "" : `offset from line ${offset >= 0 ? "+" : ""}${offset.toFixed(2)} px`,
      ]
        .filter(Boolean)
        .join("\n");
      requestAnimationFrame(tick);
    };
    tick();
  }, COUNT);
}

async function openRecorded(browser, name) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await waitUntilSettled(page);
  await installProbe(page);
  return { context, page, name };
}

async function saveVideo({ context, page, name }) {
  const video = page.video();
  await context.close();
  const file = path.join(VIDEO_DIR, `${name}.webm`);
  await rm(file, { force: true });
  await rename(await video.path(), file);
  return file;
}

const mark = (page, title, target = null) =>
  page.evaluate(
    ([t, tgt]) => {
      window.__mark = window.__changes.length;
      window.__title = t;
      window.__target = tgt;
    },
    [title, target],
  );
const changesSinceMark = (page) => page.evaluate(() => window.__changes.slice(window.__mark));
const currentIndex = (page) =>
  page.evaluate(() => Number(document.querySelector("[data-active-index]").dataset.activeIndex));

/** y (viewport px) of the boundary between zone k-1 and zone k. */
const boundaryY = (box, k) => box.top + box.height - (k * box.height) / COUNT;
const zoneCenterY = (box, zone) => box.top + box.height - ((zone + 0.5) * box.height) / COUNT;

async function glide(page, from, to, { stepPx = 1, delay = 4, jitter = 0 } = {}) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.round(distance / stepPx));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const jx = jitter ? (random() * 2 - 1) * jitter : 0;
    const jy = jitter ? (random() * 2 - 1) * jitter : 0;
    await page.mouse.move(from.x + (to.x - from.x) * t + jx, from.y + (to.y - from.y) * t + jy);
    if (delay) await sleep(delay);
  }
}

/** Approach the boundary from one side, park exactly on it, then wiggle ±1–4 px for `ms`. */
async function wiggleOnBoundary(page, box, k, side, ms) {
  const x = box.left + box.width * 0.5;
  const startZone = side === "below" ? k - 1 : k;
  const lineY = boundaryY(box, k);
  await page.mouse.move(x, zoneCenterY(box, startZone), { steps: 6 });
  await sleep(250);
  await glide(page, { x, y: zoneCenterY(box, startZone) }, { x, y: lineY }, { stepPx: 1, delay: 8 });
  await sleep(450);
  const parkedIndex = await currentIndex(page);
  await mark(page, `Boundary ${k - 1}|${k}, approached from ${side}`, { boundary: k, y: lineY });
  const end = Date.now() + ms;
  let moves = 0;
  while (Date.now() < end) {
    const magnitude = 1 + random() * 3;
    const dy = (random() < 0.5 ? -1 : 1) * magnitude;
    const dx = (random() * 2 - 1) * 3;
    await page.mouse.move(x + dx, lineY + dy);
    moves++;
    await sleep(16);
  }
  await page.mouse.move(x, lineY);
  await sleep(300);
  const changes = await changesSinceMark(page);
  await mark(page, "");
  return { parkedIndex, expected: startZone, changes, moves };
}

async function slowPass(page, box, direction, jitter) {
  const x = box.left + box.width * 0.5;
  const below = { x, y: box.top + box.height + 24 };
  const above = { x, y: box.top - 24 };
  const [from, to] = direction === "up" ? [below, above] : [above, below];
  await page.mouse.move(from.x, from.y);
  await sleep(250);
  await mark(page, `Slow pass ${direction}${jitter ? ` with ±${jitter}px tremor` : ""}`);
  await glide(page, from, to, { stepPx: 1, delay: 6, jitter });
  await sleep(500);
  const changes = await changesSinceMark(page);
  await mark(page, "");
  return changes;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  const browser = await launch();
  const report = {};

  // 1. Boundary wiggle (recorded)
  {
    const session = await openRecorded(browser, "hysteresis-boundary-wiggle");
    const { page } = session;
    const box = await deckBox(page);
    const zone = box.height / COUNT;
    await page.mouse.move(box.left + box.width / 2, box.top + box.height + 60);
    await mark(page, "Hysteresis check: parking on zone boundaries");
    await sleep(600);
    const cases = [
      [4, "below"],
      [8, "above"],
      [1, "below"],
      [11, "above"],
    ];
    report.wiggle = [];
    for (const [k, side] of cases) {
      const result = await wiggleOnBoundary(page, box, k, side, k === 4 || k === 8 ? 3500 : 2200);
      report.wiggle.push({ boundary: `${k - 1}|${k}`, side, ...result, changes: result.changes.length });
      check(
        result.parkedIndex === result.expected,
        `boundary ${k - 1}|${k} from ${side}: parked on card ${result.parkedIndex} (expected ${result.expected})`,
      );
      check(
        result.changes.length === 0,
        `boundary ${k - 1}|${k} from ${side}: ${result.changes.length} index changes during ${result.moves} wiggle moves`,
      );
    }
    report.zoneHeightPx = Number(zone.toFixed(2));
    report.wiggleVideo = await saveVideo(session);
  }

  // 2. Slow passes over the whole deck (recorded) and 3. fast sweeps
  {
    const session = await openRecorded(browser, "hysteresis-slow-passes");
    const { page } = session;
    const box = await deckBox(page);
    const zone = box.height / COUNT;
    const up = Array.from({ length: COUNT - 1 }, (_, i) => i + 1);
    const down = Array.from({ length: COUNT - 1 }, (_, i) => COUNT - 2 - i);
    report.passes = [];
    for (const jitter of [0, 1.5]) {
      for (const direction of ["up", "down"]) {
        const changes = await slowPass(page, box, direction, jitter);
        const sequence = changes.map((c) => c.index);
        const expected = direction === "up" ? up : down;
        const ok = JSON.stringify(sequence) === JSON.stringify(expected);
        // Where each switch happened, measured past the boundary it crossed (in zone heights).
        const overshoot = changes.map((c) => {
          const k = direction === "up" ? c.index : c.index + 1;
          const past = direction === "up" ? boundaryY(box, k) - c.y : c.y - boundaryY(box, k);
          return past / zone;
        });
        report.passes.push({
          direction,
          jitter,
          sequence,
          switchPastBoundary: {
            min: Number(Math.min(...overshoot).toFixed(3)),
            max: Number(Math.max(...overshoot).toFixed(3)),
          },
        });
        check(
          ok,
          `slow pass ${direction}${jitter ? ` (±${jitter}px tremor)` : ""}: [${sequence.join(", ")}]`,
        );
      }
    }
    report.passesVideo = await saveVideo(session);

    const context = await browser.newContext({ viewport: VIEWPORT });
    const fast = await context.newPage();
    await fast.goto(BASE_URL, { waitUntil: "networkidle" });
    await waitUntilSettled(fast);
    await installProbe(fast);
    const x = box.left + box.width / 2;
    await fast.mouse.move(x, zoneCenterY(box, 0));
    await sleep(300);
    await mark(fast, "fast");
    await fast.mouse.move(x, zoneCenterY(box, 11));
    await sleep(120);
    await fast.mouse.move(x, zoneCenterY(box, 2), { steps: 2 });
    await sleep(120);
    await fast.mouse.move(x, zoneCenterY(box, 7));
    await sleep(400);
    const jumps = (await changesSinceMark(fast)).map((c) => c.index);
    report.fastSweep = jumps;
    check(jumps[0] === 11, `fast sweep 0 → 11 lands directly (changes: [${jumps.join(", ")}])`);
    check(jumps[jumps.length - 1] === 7, "fast sweep ends on card 7");
    check(jumps.length <= 4, `fast sweeps did not step through every card (${jumps.length} changes)`);
    await context.close();
  }

  await browser.close();
  await rm(RAW_DIR, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll hysteresis checks passed.");
}

await main();
