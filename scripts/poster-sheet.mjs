// Captures every poster as the active card and tiles them into one contact sheet.
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { deckBox, launch, openPage } from "./lib/browser.mjs";

const out = "showcase/scratch/posters";
await mkdir(out, { recursive: true });
const browser = await launch();
const { page, problems } = await openPage(browser, { deviceScaleFactor: 2 });
const box = await deckBox(page);
for (let i = 0; i < 12; i++) {
  if (i > 0) await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(900);
  const top = box.top + (11 - i) * 16;
  await page.screenshot({
    path: `${out}/${String(i).padStart(2, "0")}.png`,
    clip: { x: box.left, y: top, width: 420, height: 260 },
  });
}
await browser.close();
execFileSync("ffmpeg", [
  "-v", "error", "-y",
  "-i", `${out}/%02d.png`,
  "-vf", "scale=630:390,tile=4x3:padding=12:margin=12:color=0xf7f6f3",
  "-frames:v", "1",
  "showcase/scratch/poster-sheet.png",
]);
console.log(problems.length ? problems.join("\n") : "no console problems");
