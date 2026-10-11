import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * High-quality page recording via the DevTools screencast, encoded with ffmpeg
 * (Playwright's built-in recorder caps the bitrate, which bands gradients).
 */
export async function startRecording(page, { quality = 92 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality, everyNthFrame: 1 });

  return {
    async stop(file, { fps = 30 } = {}) {
      await cdp.send("Page.stopScreencast");
      await cdp.detach();
      const dir = await mkdtemp(path.join(tmpdir(), "glow-deck-"));
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const name = `f${String(i).padStart(5, "0")}.jpg`;
        await writeFile(path.join(dir, name), Buffer.from(frames[i].data, "base64"));
        const next = frames[i + 1]?.t ?? frames[i].t + 1 / fps;
        lines.push(`file '${name}'`, `duration ${Math.max(next - frames[i].t, 0.001).toFixed(4)}`);
      }
      lines.push(`file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'`);
      await writeFile(path.join(dir, "frames.txt"), lines.join("\n"));
      execFileSync("ffmpeg", [
        "-v", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", path.join(dir, "frames.txt"),
        "-vf", `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
        "-c:v", "libx264", "-preset", "slow", "-crf", "17",
        "-movflags", "+faststart",
        path.resolve(file),
      ]);
      await rm(dir, { recursive: true, force: true });
      return { file: path.resolve(file), frames: frames.length };
    },
  };
}

/** Test-only cursor overlay: recordings don't include the OS cursor. */
export async function showCursor(page) {
  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.2 1.4L9.6 19z" fill="#17161b" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    cursor.style.cssText =
      "position:fixed;left:-4px;top:-2px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.25));transform:translate(-100px,-100px)";
    document.body.append(cursor);
    window.addEventListener(
      "pointermove",
      (event) => {
        cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      },
      { capture: true, passive: true },
    );
  });
}
