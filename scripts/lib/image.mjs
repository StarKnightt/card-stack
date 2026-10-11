import { PNG } from "pngjs";

export const decode = (buffer) => PNG.sync.read(buffer);
export const encode = (image) => PNG.sync.write(image);

export function crop(image, x, y, width, height) {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  width = Math.min(Math.round(width), image.width - x);
  height = Math.min(Math.round(height), image.height - y);
  if (width <= 0 || height <= 0) {
    throw new Error(`crop ${x},${y} ${width}x${height} is outside ${image.width}x${image.height}`);
  }
  const out = new PNG({ width, height });
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * image.width + x) * 4;
    image.data.copy(out.data, row * width * 4, from, from + width * 4);
  }
  return out;
}

export function upscale(image, factor) {
  const out = new PNG({ width: image.width * factor, height: image.height * factor });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const from = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
      image.data.copy(out.data, (y * out.width + x) * 4, from, from + 4);
    }
  }
  return out;
}

export function luminance(image) {
  const lum = new Float32Array(image.width * image.height);
  for (let i = 0; i < lum.length; i++) {
    const o = i * 4;
    lum[i] = 0.2126 * image.data[o] + 0.7152 * image.data[o + 1] + 0.0722 * image.data[o + 2];
  }
  return { width: image.width, height: image.height, lum };
}

/** Mean absolute Laplacian: how much pixel-scale detail survives (1:1 vs resampled). */
export function highFrequency({ width, height, lum }) {
  let sum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      sum += Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - width] - lum[i + width]);
      count++;
    }
  }
  return sum / count;
}

/** Difference of two equally sized luminance maps: mean |Δ|, share of pixels > 6/255, and Δ's pixel-scale detail. */
export function frameDifference(a, b) {
  const diff = new Float32Array(a.lum.length);
  let sum = 0;
  let changed = 0;
  for (let i = 0; i < diff.length; i++) {
    diff[i] = a.lum[i] - b.lum[i];
    sum += Math.abs(diff[i]);
    if (Math.abs(diff[i]) > 6) changed++;
  }
  return {
    meanAbs: sum / diff.length,
    changedShare: changed / diff.length,
    flicker: highFrequency({ width: a.width, height: a.height, lum: diff }),
  };
}
