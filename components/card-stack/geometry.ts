/**
 * Deck geometry, in unscaled deck pixels.
 *
 * Every card owns a fixed slot: card i spans [slotTop(i), slotTop(i) + CARD_H]
 * when it is active, so the active card always sits at its own height and the
 * hover zone that selects it always lies inside it. Cards behind the active one
 * lean back with their top edge pinned to their slot (a thin strip above it);
 * cards already flipped past fall forward on their bottom edge into thin strips
 * below it. Paint order never changes (lower index in front), so a card is
 * only ever revealed or covered by real motion, never by a z-index swap.
 */

export const COUNT = 12;
export const CARD_W = 420;
export const CARD_H = 260;
export const RADIUS = 22;
/** Visible thickness of each strip, and how far apart the slots are. */
export const BAND = 16;

/**
 * A neighbouring card only takes over once the pointer is this far (in zone
 * heights) past the boundary, and it has to come back past the same margin on
 * the other side to switch back.
 */
export const HYSTERESIS = 0.3;

const PERSPECTIVE = 2000;
/** Projection centre, above the deck, so the deck is seen from slightly above. */
const CAMERA_Y = -220;
const ORIGIN_TO_CAMERA = CAMERA_Y - CARD_H / 2;
const DEG = Math.PI / 180;

const LEAN = 50;
const LEAN_PER_CARD = 1.4;
const SHRINK_BEHIND = 0.042;
const LYING_SCALE = 0.9;
const SHRINK_BELOW = 0.035;
export const TILT_X = 6;
export const TILT_Y = 7;
export const TILT_PERSPECTIVE = 900;

export const slotTop = (i: number) => (COUNT - 1 - i) * BAND;
export const slotBottom = (i: number) => slotTop(i) + CARD_H;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutSine = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;

/** Pointer position (in zone heights from the bottom of the hit area) to card index. */
export function resolveIndex(
  current: number,
  u: number,
  count = COUNT,
  margin = HYSTERESIS,
): number {
  if (u >= current + 1 + margin) return Math.min(count - 1, Math.floor(u - margin));
  if (u < current - margin) return Math.max(0, Math.floor(u + margin));
  return current;
}

/** How "active" card i is at a given deck position: 1 when it is the active card. */
export function activeWeight(i: number, pos: number): number {
  return clamp(1 - Math.abs(i - pos) * 1.4, 0, 1);
}

function belowScale(depth: number): number {
  const lie = Math.min(depth, 1);
  return (1 - (1 - LYING_SCALE) * lie) / (1 + SHRINK_BELOW * Math.max(depth - 1, 0));
}

function project(y: number, z: number): number {
  return CAMERA_Y + ((y - CAMERA_Y) * PERSPECTIVE) / (PERSPECTIVE - z);
}

/**
 * Forward lean (degrees) at which a card hinged at its bottom edge shows
 * exactly one BAND of its face above the hinge.
 */
function lyingAngle(i: number, scale: number): number {
  const hinge = slotBottom(i);
  const length = CARD_H * scale;
  const shown = (angle: number) =>
    hinge - project(hinge - length * Math.cos(angle * DEG), length * Math.sin(angle * DEG));
  let lo = 0;
  let hi = 89;
  for (let step = 0; step < 24; step++) {
    const mid = (lo + hi) / 2;
    if (shown(mid) > BAND) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const n = (v: number) => Number(v.toFixed(3));

/**
 * Rounds a deck-pixel offset to whole device pixels (`pixelScale` is device pixels
 * per deck pixel). Chrome snaps a 2D-transformed layer's origin to the pixel grid,
 * so a whole-pixel offset from there keeps the canvas exactly on device pixels.
 */
const snap = (v: number, pixelScale: number) => Math.round(v * pixelScale) / pixelScale;

/** Card i is the active card and nothing is moving or tilting it. */
export const isRestingActive = (i: number, pos: number, tiltX: number, tiltY: number) =>
  i === pos && tiltX === 0 && tiltY === 0;

/**
 * CSS transform for card i at continuous deck position `pos`, with pointer tilt
 * in [-1, 1], snapped to the device-pixel grid.
 */
export function cardTransform(
  i: number,
  pos: number,
  tiltX = 0,
  tiltY = 0,
  pixelScale = 1,
): string {
  // A resting active card is a whole-pixel 2D translation, so its canvas is drawn 1:1, unresampled.
  if (isRestingActive(i, pos, tiltX, tiltY)) {
    return `translate(0px, ${snap(slotTop(i), pixelScale)}px)`;
  }

  const p = i - pos;
  let scale: number;
  let angle: number;
  let offset: number;

  if (p >= 0) {
    scale = 1 / (1 + SHRINK_BEHIND * p);
    angle = LEAN * easeOutCubic(Math.min(p, 1)) + LEAN_PER_CARD * Math.max(p - 1, 0);
    const length = CARD_H * scale;
    const zTop = -length * Math.sin(angle * DEG);
    const top = snap(slotTop(i), pixelScale);
    const yTop = CAMERA_Y + ((top - CAMERA_Y) * (PERSPECTIVE - zTop)) / PERSPECTIVE;
    offset = yTop - CARD_H / 2 - length / 2 + length * Math.cos(angle * DEG);
  } else {
    const depth = -p;
    scale = belowScale(depth);
    angle =
      depth >= 1
        ? -lyingAngle(i, scale)
        : -lyingAngle(i, belowScale(1)) * easeInOutSine(depth);
    offset = snap(slotBottom(i), pixelScale) - CARD_H / 2 - (CARD_H * scale) / 2;
  }

  const hinge = (CARD_H * scale) / 2;
  const weight = activeWeight(i, pos);
  const tilt =
    weight > 0 && (tiltX !== 0 || tiltY !== 0)
      ? ` perspective(${TILT_PERSPECTIVE}px) rotateX(${n(-tiltY * TILT_X * weight)}deg) rotateY(${n(tiltX * TILT_Y * weight)}deg)`
      : "";

  return (
    `translateY(${ORIGIN_TO_CAMERA}px) perspective(${PERSPECTIVE}px) ` +
    `translateY(${n(offset - ORIGIN_TO_CAMERA + hinge)}px) rotateX(${n(angle)}deg) ` +
    `translateY(${n(-hinge)}px)${tilt} scale(${n(scale)})`
  );
}

/** Opacity of the dark overlay that sells depth and the light falling off a tipped card. */
export function cardShade(i: number, pos: number): number {
  const p = i - pos;
  if (p >= 0) return 0.5 * (1 - Math.exp(-0.2 * p));
  const depth = -p;
  return 0.3 * easeInOutSine(Math.min(depth, 1)) + 0.025 * Math.max(depth - 1, 0);
}
