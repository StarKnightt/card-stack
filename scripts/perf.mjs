// Frame-rate and main-thread measurements on the real GPU.
// node scripts/perf.mjs [--headed] [--low-power]
import { chromium } from "playwright";
import { BASE_URL, deckBox, waitUntilSettled } from "./lib/browser.mjs";

const headed = process.argv.includes("--headed");
const lowPower = process.argv.includes("--low-power");
const browser = await chromium.launch({
  headless: !headed,
  args: [
    "--use-angle=d3d11",
    "--enable-gpu",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--disable-features=CalculateNativeWinOcclusion",
    lowPower ? "--force_low_power_gpu" : "--force_high_performance_gpu",
    ...(headed ? ["--window-position=-2600,0", "--window-size=1440,960"] : []),
  ],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.goto(BASE_URL, { waitUntil: "networkidle" });
await waitUntilSettled(page);
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");

const gpu = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
});

await page.evaluate(() => {
  window.__longTasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__longTasks.push(entry.duration);
  }).observe({ type: "longtask", buffered: false });
});

const metric = async () => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
};

async function measure(label, durationMs, during) {
  await page.evaluate(() => {
    window.__longTasks.length = 0;
    window.__frames = [];
    let last = performance.now();
    const loop = (now) => {
      window.__frames.push(now - last);
      last = now;
      window.__frameLoop = requestAnimationFrame(loop);
    };
    window.__frameLoop = requestAnimationFrame(loop);
  });
  const before = await metric();
  const start = Date.now();
  await during(durationMs);
  const elapsed = Date.now() - start;
  const after = await metric();
  const result = await page.evaluate(() => {
    cancelAnimationFrame(window.__frameLoop);
    const frames = window.__frames.slice(2);
    const sorted = [...frames].sort((a, b) => a - b);
    const total = frames.reduce((s, f) => s + f, 0);
    return {
      fps: Number(((frames.length / total) * 1000).toFixed(1)),
      p95FrameMs: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
      maxFrameMs: Number(sorted[sorted.length - 1].toFixed(2)),
      over20ms: frames.filter((f) => f > 20).length,
      frames: frames.length,
      longTasks: window.__longTasks.length,
      longestTaskMs: window.__longTasks.length ? Math.max(...window.__longTasks) : 0,
    };
  });
  const busy = (after.TaskDuration - before.TaskDuration) * 1000;
  result.mainThreadBusyPct = Number(((busy / elapsed) * 100).toFixed(1));
  console.log(label.padEnd(26), JSON.stringify(result));
  return result;
}

const idle = (ms) => page.waitForTimeout(ms);
const box = await deckBox(page);
const scrub = async (ms) => {
  const end = Date.now() + ms;
  let direction = -1;
  let y = box.top + box.height - 4;
  await page.mouse.move(box.left + box.width / 2, y);
  while (Date.now() < end) {
    y += direction * 9;
    if (y < box.top + 4 || y > box.top + box.height - 4) direction *= -1;
    await page.mouse.move(box.left + box.width / 2 + Math.sin(y / 40) * 60, y);
  }
};
const expanded = async (ms) => {
  await page.waitForTimeout(ms);
};

console.log(`GPU: ${gpu}${headed ? " (headed window)" : " (headless)"}`);
await measure("idle (12 live posters)", 4000, idle);
await measure("continuous scrubbing", 4000, scrub);
await page.mouse.move(box.left + box.width / 2, box.top + box.height - 40);
await page.waitForTimeout(600);
await page.mouse.click(box.left + box.width / 2, box.top + box.height - 40);
await page.waitForTimeout(900);
await measure("expanded", 4000, expanded);
await page.keyboard.press("Escape");
await page.waitForTimeout(900);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await measure("idle, 4x CPU throttle", 4000, idle);
await measure("scrubbing, 4x CPU throttle", 4000, scrub);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
await browser.close();
