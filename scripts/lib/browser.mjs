import { chromium } from "playwright";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3100";

/** Hardware-accelerated Chromium (headless SwiftShader would make shader timings meaningless). */
export async function launch({ headed = false } = {}) {
  return chromium.launch({
    headless: !headed,
    args: [
      "--use-angle=d3d11",
      "--enable-gpu",
      "--enable-gpu-rasterization",
      "--ignore-gpu-blocklist",
      "--disable-features=CalculateNativeWinOcclusion",
    ],
  });
}

export async function openPage(browser, { width = 1440, height = 900, ...options } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
    ...options,
  });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`[${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`[pageerror] ${error.message}`));
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-active-index]");
  await waitUntilSettled(page);
  return { context, page, problems };
}

/** All posters drawn and the entrance animation finished (the deck is measured afterwards). */
export async function waitUntilSettled(page) {
  await page.waitForFunction(
    () => document.querySelectorAll("canvas[data-ready]").length >= 12,
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => !(a instanceof CSSAnimation) || a.playState === "finished"),
  );
}

export async function deckBox(page) {
  return page.evaluate(() => {
    const hit = document.querySelector('[aria-roledescription="poster deck"]');
    const r = hit.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

export const activeIndex = (page) =>
  page.evaluate(() => Number(document.querySelector("[data-active-index]").dataset.activeIndex));
