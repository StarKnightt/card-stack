"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { getPosterRenderer } from "@/lib/gl/renderer";
import { usePosterCanvas } from "@/lib/gl/use-poster-canvas";
import { CARD_H, CARD_W, COUNT, RADIUS, TILT_PERSPECTIVE } from "./geometry";
import { posterFallback, type Poster } from "./posters";
import styles from "./card-stack.module.css";

export type Rect = { left: number; top: number; width: number; height: number };

type ExpandedPosterProps = {
  poster: Poster;
  index: number;
  /** Where the poster sits in the deck, in viewport pixels. */
  from: Rect;
  /** Pointer tilt of the deck card at the moment it was opened, in degrees. */
  fromTilt: { x: number; y: number };
  closing: boolean;
  reducedMotion: boolean;
  onClose: () => void;
  onClosed: () => void;
};

const EXPANDED_RADIUS = 30;
/** Keeps the expanded shader within a sensible pixel budget on large, dense screens. */
const MAX_PIXELS = 2_600_000;

/** Centred target, on whole device pixels so the resting poster maps 1:1 onto the screen. */
function targetRect(): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ratio = window.devicePixelRatio || 1;
  const narrow = vw < 640;
  const width = Math.min(1080, vw * (narrow ? 0.92 : 0.88), (vh - 200) * (CARD_W / CARD_H));
  const height = width * (CARD_H / CARD_W);
  const px = (v: number) => Math.round(v * ratio) / ratio;
  return {
    left: px((vw - width) / 2),
    top: px((vh - height) / 2 - (narrow ? 40 : 26)),
    width: px(width),
    height: px(height),
  };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

export function ExpandedPoster({
  poster,
  index,
  from,
  fromTilt,
  closing,
  reducedMotion,
  onClose,
  onClosed,
}: ExpandedPosterProps) {
  const [to, setTo] = useState(targetRect);
  const progress = useMotionValue(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(to.width * ratio);
    const height = Math.round(to.height * ratio);
    const quality = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)));
    return {
      width,
      height,
      qualityX: quality,
      qualityY: quality,
      interval: 1000 / 60,
      timeOffset: poster.seed * 37,
      grain: 1,
    };
  }, [to, poster.seed]);
  const handle = usePosterCanvas(canvasRef, poster, options, true);

  useLayoutEffect(() => {
    const renderer = getPosterRenderer();
    if (!renderer) return;
    renderer.setSolo(closing ? null : handle.current);
    return () => renderer.setSolo(null);
  }, [closing, handle]);

  useEffect(() => {
    const onResize = () => setTo(targetRect());
    window.addEventListener("resize", onResize);
    dialogRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const controls = closing
      ? animate(
          progress,
          0,
          reducedMotion
            ? { duration: 0.2, ease: "easeIn" }
            : { type: "spring", stiffness: 330, damping: 36, restDelta: 0.0005 },
        )
      : animate(
          progress,
          1,
          reducedMotion
            ? { duration: 0.24, ease: "easeOut" }
            : { type: "spring", stiffness: 230, damping: 25, mass: 1 },
        );
    if (closing) controls.then(onClosed);
    return () => controls.stop();
  }, [closing, onClosed, progress, reducedMotion]);

  const scaleFrom = from.width / to.width;
  const deckZoom = from.width / CARD_W;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);

  const transform = useTransform(progress, (t) => {
    // At rest nothing transforms it, so the canvas is drawn 1:1.
    if (t === 1) return "none";
    const scale = mix(scaleFrom, 1, t);
    const rest = Math.max(0, 1 - t);
    return (
      `translate3d(${(dx * rest).toFixed(2)}px, ${(dy * rest).toFixed(2)}px, 0) ` +
      `perspective(${(TILT_PERSPECTIVE * deckZoom).toFixed(1)}px) ` +
      `rotateX(${(fromTilt.x * rest).toFixed(3)}deg) rotateY(${(fromTilt.y * rest).toFixed(3)}deg) ` +
      `scale(${scale.toFixed(4)})`
    );
  });
  const borderRadius = useTransform(progress, (t) => {
    const scale = mix(scaleFrom, 1, t);
    return mix(RADIUS * deckZoom, EXPANDED_RADIUS, clamp01(t)) / scale;
  });
  const backdropOpacity = useTransform(progress, clamp01);
  const metaOpacity = useTransform(progress, (t) => clamp01((t - 0.6) / 0.4));
  const metaY = useTransform(progress, (t) => (1 - clamp01(t)) * 10);

  return createPortal(
    <>
      <motion.div
        className={styles.backdrop}
        style={{ opacity: backdropOpacity }}
        onClick={onClose}
        aria-hidden
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${poster.title}, ${poster.collection}. Press Escape to close.`}
        tabIndex={-1}
        className={styles.expanded}
        style={{
          left: to.left,
          top: to.top,
          width: to.width,
          height: to.height,
          transform,
          borderRadius,
          backgroundImage: posterFallback(poster),
        }}
        onClick={onClose}
      >
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ width: to.width, height: to.height }}
        />
        <div className={styles.edge} />
      </motion.div>
      <motion.div
        className={styles.meta}
        style={{
          left: to.left + 4,
          width: to.width - 8,
          top: to.top + to.height + 22,
          opacity: metaOpacity,
          y: metaY,
        }}
        aria-hidden
      >
        <div className={styles.metaTitle}>
          <span className={styles.metaName}>{poster.title}</span>
          <span className={styles.metaSmall}>{poster.collection}</span>
        </div>
        <span className={styles.metaSmall}>
          {String(index + 1).padStart(2, "0")} / {COUNT} · Esc
        </span>
      </motion.div>
    </>,
    document.body,
  );
}
