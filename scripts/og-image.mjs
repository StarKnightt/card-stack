// Social images from the live app: the real, fully rendered deck, restyled into a share-card
// layout and captured at 2x, then downsampled.
// node scripts/og-image.mjs [--active 5] [--out dir]   (app on BASE_URL, default http://localhost:3100)
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { BASE_URL, launch, waitUntilSettled } from "./lib/browser.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const active = Number(arg("--active", "1"));
const out = arg("--out", null);

const targets = out
  ? [{ file: path.join(out, `og-${active}.png`), width: 1200, height: 630 }]
  : [
      { file: "docs/social-preview.png", width: 1280, height: 640 },
      { file: "app/opengraph-image.png", width: 1200, height: 630 },
    ];

const SCALE = 2;
const browser = await launch();

for (const { file, width, height } of targets) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await waitUntilSettled(page);
  await page.mouse.move(2, 2);

  // The deck is 420px wide at zoom 1; place it in the right half, centred in its column.
  const deckScale = (height / 630) * 1.04;
  const margin = Math.round(width * 0.075);
  const deckCenter = width - margin - (420 * deckScale) / 2 + 6;
  await page.addStyleTag({
    content: `
      section[aria-roledescription="carousel"] header,
      section[aria-roledescription="carousel"] nav { display: none !important; }
      main > p { visibility: hidden !important; }
      section[aria-roledescription="carousel"] {
        --deck-scale: ${deckScale} !important;
        transform: translateX(${Math.round(deckCenter - width / 2)}px);
      }
      .og-copy {
        position: fixed;
        left: ${margin}px;
        top: 50%;
        translate: 0 -54%;
        width: ${Math.round(width * 0.42)}px;
        color: var(--color-ink);
      }
      .og-label {
        font-family: var(--font-mono);
        font-size: ${Math.round(14 * (height / 630))}px;
        letter-spacing: 0.26em;
        text-transform: uppercase;
        color: rgb(23 22 27 / 0.46);
      }
      .og-title {
        margin-top: ${Math.round(22 * (height / 630))}px;
        font-family: var(--font-display);
        font-size: ${Math.round(98 * (height / 630))}px;
        font-weight: 500;
        line-height: 0.94;
        letter-spacing: -0.045em;
      }
      .og-subtitle {
        margin-top: ${Math.round(24 * (height / 630))}px;
        font-family: var(--font-display);
        font-size: ${Math.round(29 * (height / 630))}px;
        letter-spacing: -0.012em;
        color: rgb(23 22 27 / 0.56);
      }
    `,
  });
  await page.evaluate(() => {
    const copy = document.createElement("div");
    copy.className = "og-copy";
    copy.innerHTML =
      '<div class="og-label">Card Stack · 12 live WebGL posters</div>' +
      '<div class="og-title">Glow Deck</div>' +
      '<div class="og-subtitle">A stack of living posters.</div>';
    document.body.append(copy);
  });

  const hit = page.locator('[aria-roledescription="poster deck"]');
  await hit.focus();
  for (let i = 0; i < active; i++) await page.keyboard.press("ArrowUp");
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(1600);
  await page.evaluate(() => document.fonts.ready);

  const shot = path.resolve(`${file}.2x.png`);
  await page.screenshot({ path: shot });
  await context.close();

  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-i", shot,
    "-vf", `scale=${width}:${height}:flags=lanczos+accurate_rnd`,
    "-compression_level", "9", "-pred", "mixed",
    path.resolve(file),
  ]);
  execFileSync(process.platform === "win32" ? "cmd" : "rm", process.platform === "win32" ? ["/c", "del", shot] : [shot]);
  console.log(`${file} ${width}x${height}`);
}

await browser.close();
