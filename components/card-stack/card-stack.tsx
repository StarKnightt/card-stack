"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { animate, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { getPosterRenderer } from "@/lib/gl/renderer";
import { DotTrack } from "./dot-track";
import { ExpandedPoster, type Rect } from "./expanded-poster";
import {
  CARD_H,
  CARD_W,
  COUNT,
  TILT_X,
  TILT_Y,
  activeWeight,
  resolveIndex,
  slotTop,
} from "./geometry";
import { POSTERS } from "./posters";
import { CardGlow, StackCard, type PointerMotion } from "./stack-card";
import { StackHeader } from "./stack-header";
import { useThrottledIndex } from "./use-throttled-index";
import styles from "./card-stack.module.css";

type Expansion = { from: Rect; tilt: { x: number; y: number }; closing: boolean };

type PointerState = {
  x: number;
  y: number;
  inside: boolean;
  /** Set after a key, wheel or dot moved the deck under a resting pointer. */
  anchor: { x: number; y: number } | null;
  /** The next pointer entry should not flip the deck (e.g. right after closing). */
  holdOnEnter: boolean;
};

type TouchState = {
  id: number;
  startY: number;
  startPos: number;
  startIndex: number;
  startTime: number;
  zoom: number;
  moved: boolean;
  samples: { t: number; y: number }[];
};

const DECK_SPRING = { type: "spring", stiffness: 300, damping: 27, mass: 1 } as const;
const DECK_SPRING_REDUCED = { type: "spring", stiffness: 420, damping: 60, mass: 1 } as const;
const TILT_SPRING = { stiffness: 160, damping: 19, mass: 0.7 };
const HOVER_SPRING = { stiffness: 200, damping: 26 };
/** Deck pixels a resting pointer must travel before it takes over from keys, wheel or dots again. */
const POINTER_REENGAGE = 14;
/** Deck pixels of finger travel per card while swiping. */
const SWIPE_STEP = 46;
const WHEEL_THRESHOLD = 40;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Viewport rect of card i's slot, from the hit area's rect. */
function slotRect(hit: DOMRect, i: number): Rect {
  const k = hit.width / CARD_W;
  return { left: hit.left, top: hit.top + slotTop(i) * k, width: CARD_W * k, height: CARD_H * k };
}

function rubberBand(value: number, min: number, max: number) {
  if (value < min) return min - (1 - 1 / ((min - value) * 0.55 + 1)) / 0.55;
  if (value > max) return max + (1 - 1 / ((value - max) * 0.55 + 1)) / 0.55;
  return value;
}

export function CardStack() {
  const reducedMotion = useReducedMotion() ?? false;
  const [index, setIndex] = useState(0);
  const [expansion, setExpansion] = useState<Expansion | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [announcement, setAnnouncement] = useState("");

  const pos = useMotionValue(0);
  const pixelScale = useMotionValue(1);
  const tiltXTarget = useMotionValue(0);
  const tiltYTarget = useMotionValue(0);
  const glareXTarget = useMotionValue(0.5);
  const glareYTarget = useMotionValue(0.5);
  const hoverTarget = useMotionValue(0);
  const tiltX = useSpring(tiltXTarget, TILT_SPRING);
  const tiltY = useSpring(tiltYTarget, TILT_SPRING);
  const glareX = useSpring(glareXTarget, TILT_SPRING);
  const glareY = useSpring(glareYTarget, TILT_SPRING);
  const hover = useSpring(hoverTarget, HOVER_SPRING);
  const pointerMotion = useMemo<PointerMotion>(
    () => ({ tiltX, tiltY, glareX, glareY, hover }),
    [tiltX, tiltY, glareX, glareY, hover],
  );

  const indexRef = useRef(0);
  const expansionRef = useRef<Expansion | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const deckRowRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const pointerRef = useRef<PointerState>({
    x: Number.NaN,
    y: Number.NaN,
    inside: false,
    anchor: null,
    holdOnEnter: false,
  });
  const touchRef = useRef<TouchState | null>(null);
  /** Browsers may still fire a click after a swipe; ignore clicks until this time. */
  const ignoreClicksUntil = useRef(0);
  const wheelRef = useRef({ acc: 0, lastEvent: 0, lastStep: 0 });

  const measure = useCallback(() => {
    const el = hitRef.current;
    rectRef.current = el ? el.getBoundingClientRect() : null;
    return rectRef.current;
  }, []);

  /**
   * Device pixels per deck pixel. Card offsets are snapped to it and canvases are
   * sized to it, so at fractional devicePixelRatios (e.g. 1.2 or 1.25) a resting
   * card still maps 1:1 onto the screen instead of being resampled.
   */
  const updatePixelScale = useCallback(() => {
    const row = deckRowRef.current;
    if (!row) return;
    const zoom = Number.parseFloat(getComputedStyle(row).zoom) || 1;
    const scale = zoom * (window.devicePixelRatio || 1);
    pixelScale.set(scale);
    setRenderScale(scale);
  }, [pixelScale]);

  const commitIndex = useCallback((target: number) => {
    const next = clamp(target, 0, COUNT - 1);
    const current = indexRef.current;
    if (next === current) return false;
    indexRef.current = next;
    setIndex(next);
    // Fires for every change, including ones React would batch into a single render.
    stageRef.current?.dispatchEvent(
      new CustomEvent("cardchange", { detail: { index: next, previous: current } }),
    );
    return true;
  }, []);

  const settle = useCallback(
    (target: number) => {
      animate(pos, target, reducedMotion ? DECK_SPRING_REDUCED : DECK_SPRING);
    },
    [pos, reducedMotion],
  );

  const goTo = useCallback(
    (target: number) => {
      if (expansionRef.current) return;
      if (commitIndex(target)) settle(indexRef.current);
    },
    [commitIndex, settle],
  );

  /** Keys, wheel and dots win over a pointer that is resting on the deck. */
  const anchorPointer = useCallback(() => {
    const pointer = pointerRef.current;
    pointer.anchor = pointer.inside ? { x: pointer.x, y: pointer.y } : null;
  }, []);

  const resetTilt = useCallback(() => {
    hoverTarget.set(0);
    tiltXTarget.set(0);
    tiltYTarget.set(0);
  }, [hoverTarget, tiltXTarget, tiltYTarget]);

  const updateTilt = useCallback(
    (x: number, y: number, rect: DOMRect) => {
      if (reducedMotion) return;
      const k = rect.width / CARD_W;
      const dx = x / k;
      const dy = y / k;
      const top = slotTop(indexRef.current);
      tiltXTarget.set(clamp((dx - CARD_W / 2) / (CARD_W / 2), -1, 1));
      tiltYTarget.set(clamp((dy - top - CARD_H / 2) / (CARD_H / 2), -1, 1));
      glareXTarget.set(clamp(dx / CARD_W, 0, 1));
      glareYTarget.set(clamp((dy - top) / CARD_H, 0, 1));
    },
    [reducedMotion, tiltXTarget, tiltYTarget, glareXTarget, glareYTarget],
  );

  /**
   * The deck index comes only from where the pointer is inside the fixed hit
   * area, never from the moving cards, with a dead zone around every boundary.
   */
  const hoverAt = useCallback(
    (x: number, y: number, rect: DOMRect) => {
      const pointer = pointerRef.current;
      if (Math.abs(x - pointer.x) < 1 && Math.abs(y - pointer.y) < 1) return;
      pointer.x = x;
      pointer.y = y;
      if (pointer.anchor) {
        const k = rect.width / CARD_W;
        const travel = Math.hypot(x - pointer.anchor.x, y - pointer.anchor.y);
        if (travel < POINTER_REENGAGE * k) {
          updateTilt(x, y, rect);
          return;
        }
        pointer.anchor = null;
      }
      const zone = rect.height / COUNT;
      goTo(resolveIndex(indexRef.current, (rect.height - y) / zone));
      updateTilt(x, y, rect);
    },
    [goTo, updateTilt],
  );

  const open = useCallback(() => {
    if (expansionRef.current) return;
    const rect = measure();
    if (!rect) return;
    const i = indexRef.current;
    const weight = activeWeight(i, pos.get());
    const next: Expansion = {
      from: slotRect(rect, i),
      tilt: { x: -tiltY.get() * TILT_X * weight, y: tiltX.get() * TILT_Y * weight },
      closing: false,
    };
    expansionRef.current = next;
    setExpansion(next);
    const pointer = pointerRef.current;
    pointer.inside = false;
    pointer.anchor = null;
    resetTilt();
  }, [measure, pos, resetTilt, tiltX, tiltY]);

  const close = useCallback(() => {
    const current = expansionRef.current;
    if (!current || current.closing) return;
    const rect = measure();
    const next: Expansion = {
      ...current,
      // Re-measured so the poster lands back in its slot even after a resize.
      from: rect ? slotRect(rect, indexRef.current) : current.from,
      closing: true,
    };
    expansionRef.current = next;
    setExpansion(next);
  }, [measure]);

  const onClosed = useCallback(() => {
    expansionRef.current = null;
    setExpansion(null);
    pointerRef.current.holdOnEnter = true;
    hitRef.current?.focus({ preventScroll: true });
  }, []);

  /** A click or tap on the active card expands it; anywhere else on the deck selects that card. */
  const pressAt = useCallback(
    (clientY: number) => {
      const rect = measure();
      if (!rect || expansionRef.current) return;
      const k = rect.width / CARD_W;
      const y = (clientY - rect.top) / k;
      const top = slotTop(indexRef.current);
      if (y >= top && y <= top + CARD_H) {
        open();
        return;
      }
      pointerRef.current.anchor = null;
      goTo(Math.floor((rect.height - (clientY - rect.top)) / (rect.height / COUNT)));
    },
    [goTo, measure, open],
  );

  const onPointerEnter = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const rect = measure();
    if (!rect) return;
    const pointer = pointerRef.current;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    pointer.inside = true;
    pointer.anchor = pointer.holdOnEnter ? { x, y } : null;
    pointer.holdOnEnter = false;
    pointer.x = Number.NaN;
    if (!reducedMotion) hoverTarget.set(1);
    hoverAt(x, y, rect);
  };

  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const pointer = pointerRef.current;
    pointer.inside = false;
    pointer.anchor = null;
    pointer.x = Number.NaN;
    pointer.y = Number.NaN;
    resetTilt();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || expansionRef.current) return;
    const rect = measure();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pos.stop();
    const now = performance.now();
    touchRef.current = {
      id: event.pointerId,
      startY: event.clientY,
      startPos: pos.get(),
      startIndex: indexRef.current,
      startTime: now,
      zoom: rect.width / CARD_W,
      moved: false,
      samples: [{ t: now, y: event.clientY }],
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") {
      const rect = rectRef.current ?? measure();
      if (rect) hoverAt(event.clientX - rect.left, event.clientY - rect.top, rect);
      return;
    }
    const touch = touchRef.current;
    if (!touch || touch.id !== event.pointerId) return;
    const dy = event.clientY - touch.startY;
    if (!touch.moved && Math.abs(dy) < 6) return;
    touch.moved = true;
    const now = performance.now();
    touch.samples.push({ t: now, y: event.clientY });
    while (touch.samples.length > 2 && now - touch.samples[0].t > 100) touch.samples.shift();
    pos.set(rubberBand(touch.startPos - dy / (SWIPE_STEP * touch.zoom), 0, COUNT - 1));
    commitIndex(resolveIndex(indexRef.current, pos.get() + 0.5, COUNT, 0.15));
  };

  const endTouch = (event: ReactPointerEvent<HTMLDivElement>) => {
    const touch = touchRef.current;
    if (!touch || touch.id !== event.pointerId) return;
    touchRef.current = null;
    // A tap is handled by the click that follows it, so the click can't land on the opened overlay.
    if (!touch.moved) {
      settle(indexRef.current);
      return;
    }
    ignoreClicksUntil.current = performance.now() + 400;
    const first = touch.samples[0];
    const last = touch.samples[touch.samples.length - 1];
    const velocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    const projected = pos.get() - (velocity * 160) / (SWIPE_STEP * touch.zoom);
    const target = clamp(
      Math.round(projected),
      Math.max(0, touch.startIndex - 3),
      Math.min(COUNT - 1, touch.startIndex + 3),
    );
    commitIndex(target);
    settle(indexRef.current);
  };

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (performance.now() < ignoreClicksUntil.current) return;
    pressAt(event.clientY);
  };

  const selectFromTrack = useCallback(
    (i: number) => {
      goTo(i);
      anchorPointer();
    },
    [anchorPointer, goTo],
  );

  useLayoutEffect(() => {
    const row = deckRowRef.current;
    if (!row) return;
    updatePixelScale();
    const onLayoutChange = () => {
      updatePixelScale();
      measure();
    };
    const observer = new ResizeObserver(onLayoutChange);
    observer.observe(row);
    window.addEventListener("resize", onLayoutChange);
    // devicePixelRatio changes with browser zoom or a move to another monitor.
    let resolution: MediaQueryList | null = null;
    const watchResolution = () => {
      resolution?.removeEventListener("change", onResolutionChange);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener("change", onResolutionChange);
    };
    const onResolutionChange = () => {
      onLayoutChange();
      watchResolution();
    };
    watchResolution();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onLayoutChange);
      resolution?.removeEventListener("change", onResolutionChange);
    };
  }, [measure, updatePixelScale]);

  useEffect(() => {
    getPosterRenderer()?.setTimeScale(reducedMotion ? 0 : 1);
  }, [reducedMotion]);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      if (expansionRef.current) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? window.innerHeight
            : 1;
      const delta = event.deltaY * unit;
      const wheel = wheelRef.current;
      const now = performance.now();
      if (now - wheel.lastEvent > 220 || Math.sign(delta) !== Math.sign(wheel.acc)) wheel.acc = 0;
      wheel.lastEvent = now;
      wheel.acc += delta;
      // A mouse-wheel notch moves exactly one card; trackpad streams are rate limited.
      const notch = Math.abs(delta) >= 50;
      const cooldown = notch ? 40 : 120;
      if (Math.abs(wheel.acc) < WHEEL_THRESHOLD || now - wheel.lastStep < cooldown) return;
      wheel.lastStep = now;
      const step = Math.sign(wheel.acc);
      wheel.acc = 0;
      goTo(indexRef.current + step);
      anchorPointer();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [anchorPointer, goTo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (expansionRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
        return;
      }
      const current = indexRef.current;
      let next: number;
      switch (event.key) {
        case "ArrowUp":
        case "ArrowRight":
          next = current + 1;
          break;
        case "ArrowDown":
        case "ArrowLeft":
          next = current - 1;
          break;
        case "PageUp":
          next = current + 3;
          break;
        case "PageDown":
          next = current - 3;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = COUNT - 1;
          break;
        case "Enter":
        case " ":
          if (event.target === hitRef.current) {
            event.preventDefault();
            open();
          }
          return;
        default:
          return;
      }
      event.preventDefault();
      goTo(next);
      anchorPointer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [anchorPointer, close, goTo, open]);

  useEffect(() => {
    const poster = POSTERS[index];
    const id = window.setTimeout(() => {
      setAnnouncement(`${poster.title}, ${poster.collection}. ${index + 1} of ${COUNT}.`);
    }, 450);
    return () => window.clearTimeout(id);
  }, [index]);

  const poster = POSTERS[index];
  const header = useThrottledIndex(index, 70);

  return (
    <>
      <section
        ref={stageRef}
        className={styles.stage}
        aria-roledescription="carousel"
        aria-label="Glow Deck"
        data-active-index={index}
        inert={expansion !== null}
      >
        <h1 className={styles.srOnly}>Glow Deck</h1>
        <StackHeader
          poster={POSTERS[header.index]}
          direction={header.direction}
          reducedMotion={reducedMotion}
        />
        <div ref={deckRowRef} className={styles.deckRow} onAnimationEnd={measure}>
          <div className={styles.deck}>
            <div className={styles.floor} />
            {POSTERS.map((p, i) => (
              <CardGlow key={p.id} poster={p} index={i} pos={pos} />
            ))}
            {POSTERS.map((p, i) => (
              <StackCard
                key={p.id}
                poster={p}
                index={i}
                pos={pos}
                pointer={pointerMotion}
                pixelScale={pixelScale}
                scale={renderScale}
                hidden={expansion !== null && i === index}
              />
            ))}
            <div
              ref={hitRef}
              className={styles.hit}
              role="group"
              aria-roledescription="poster deck"
              aria-label="Posters. Hover, scroll or use the arrow keys to flip through, Enter to expand."
              tabIndex={0}
              onPointerEnter={onPointerEnter}
              onPointerLeave={onPointerLeave}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endTouch}
              onPointerCancel={endTouch}
              onClick={onClick}
            />
          </div>
          <DotTrack
            posters={POSTERS}
            index={index}
            reducedMotion={reducedMotion}
            onSelect={selectFromTrack}
          />
        </div>
        <p className={styles.srOnly} aria-live="polite">
          {announcement}
        </p>
      </section>
      {expansion && (
        <ExpandedPoster
          poster={poster}
          index={index}
          from={expansion.from}
          fromTilt={expansion.tilt}
          closing={expansion.closing}
          reducedMotion={reducedMotion}
          onClose={close}
          onClosed={onClosed}
        />
      )}
    </>
  );
}
