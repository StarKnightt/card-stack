// Rasterises app/icon.svg into app/favicon.ico (16/32/48) and app/apple-icon.png (180, on paper).
// node scripts/icons.mjs
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const svg = await readFile("app/icon.svg");
const src = `data:image/svg+xml;base64,${svg.toString("base64")}`;
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(size, { padding = 0, background = "transparent" } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:${background}">` +
      `<img src="${src}" style="display:block;width:${size - padding * 2}px;height:${size - padding * 2}px;margin:${padding}px">` +
      `</body>`,
  );
  await page.waitForFunction(() => document.images[0].complete);
  return page.screenshot({ omitBackground: background === "transparent" });
}

/** ICO container with PNG-compressed entries (supported by every current browser and Windows). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size % 256, 0);
    entry.writeUInt8(size % 256, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) images.push({ size, png: await render(size) });
await writeFile("app/favicon.ico", ico(images));
await writeFile("app/apple-icon.png", await render(180, { padding: 22, background: "#f7f6f3" }));
await browser.close();
console.log("app/favicon.ico (16, 32, 48), app/apple-icon.png (180)");
