"use client";

import { memo, useMemo, useRef } from "react";
import { motion, useMotionValueEvent, useTransform, type MotionValue } from "framer-motion";
import { usePosterCanvas } from "@/lib/gl/use-poster-canvas";
import {
  CARD_H,
  CARD_W,
  COUNT,
  activeWeight,
  cardShade,
  cardTransform,
  slotTop,
} from "./geometry";
import { posterFallback, type Poster } from "./posters";
import styles from "./card-stack.module.css";

export type PointerMotion = {
  tiltX: MotionValue<number>;
  tiltY: MotionValue<number>;
  glareX: MotionValue<number>;
  glareY: MotionValue<number>;
  hover: MotionValue<number>;
};

type StackCardProps = {
  poster: Poster;
  index: number;
  pos: MotionValue<number>;
  pointer: PointerMotion;
  /** Device pixels per deck pixel (page zoom × devicePixelRatio). */
  pixelScale: MotionValue<number>;
  /** Same value as `pixelScale`, as a render input for sizing the canvas. */
  scale: number;
  hidden: boolean;
};

/** Cards this close to the active position render pixel-exact. */
const NEAR = 1.6;
/** Rendering above ~2 device pixels per poster pixel costs a lot and isn't visible. */
const MAX_RENDER_SCALE = 2;

type Tier = "near" | "strip" | "flipped";

const tierOf = (p: number): Tier => (Math.abs(p) < NEAR ? "near" : p > 0 ? "strip" : "flipped");

/**
 * Strips lean back and flipped cards lie almost flat, so on screen they are
 * squashed; rendering them at that density avoids both upscaling blur and the
 * shimmer of a minified texture.
 */
const TIERS: Record<Tier, { qualityX: number; qualityY: number; grain: number }> = {
  near: { qualityX: 1, qualityY: 1, grain: 1 },
  strip: { qualityX: 0.85, qualityY: 0.62, grain: 0.6 },
  flipped: { qualityX: 0.85, qualityY: 0.12, grain: 0 },
};

export const StackCard = memo(function StackCard({
  poster,
  index,
  pos,
  pointer,
  pixelScale,
  scale,
  hidden,
}: StackCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tier = useRef<Tier | null>(null);
  const fallback = useMemo(() => posterFallback(poster), [poster]);

  // The canvas covers a whole number of device pixels (overhanging the rounded clip by
  // less than one), so at rest its backing store maps 1:1 onto the screen.
  const renderScale = Math.min(scale, MAX_RENDER_SCALE);
  const deviceWidth = Math.ceil(CARD_W * renderScale);
  const deviceHeight = Math.ceil(CARD_H * renderScale);
  const options = useMemo(
    () => ({
      width: deviceWidth,
      height: deviceHeight,
      interval: 1000 / 60,
      timeOffset: poster.seed * 37,
      ...TIERS[tierOf(index - pos.get())],
    }),
    [deviceHeight, deviceWidth, index, pos, poster.seed],
  );
  const handle = usePosterCanvas(canvasRef, poster, options);

  useMotionValueEvent(pos, "change", (value) => {
    const next = tierOf(index - value);
    if (next === tier.current) return;
    tier.current = next;
    handle.current?.update(TIERS[next]);
  });

  const transform = useTransform(
    [pos, pointer.tiltX, pointer.tiltY, pixelScale],
    ([value, tiltX, tiltY, px]: number[]) => cardTransform(index, value, tiltX, tiltY, px),
  );
  const shade = useTransform(pos, (value) => cardShade(index, value));
  const glareOpacity = useTransform(
    [pos, pointer.hover],
    ([value, hover]: number[]) => activeWeight(index, value) * hover * 0.85,
  );
  const glareTransform = useTransform(
    [pointer.glareX, pointer.glareY],
    ([x, y]: number[]) =>
      `translate(${((x - 0.5) * 66).toFixed(2)}%, ${((y - 0.5) * 50).toFixed(2)}%)`,
  );

  return (
    <motion.div
      className={styles.card}
      style={{ transform, zIndex: COUNT - index, opacity: hidden ? 0 : 1 }}
      data-card={index}
    >
      <div className={styles.face} style={{ backgroundImage: fallback }}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ width: deviceWidth / renderScale, height: deviceHeight / renderScale }}
        />
        <motion.div className={styles.shade} style={{ opacity: shade }} />
        <motion.div
          className={styles.glare}
          style={{ opacity: glareOpacity, transform: glareTransform }}
        />
        <div className={styles.edge} />
      </div>
    </motion.div>
  );
});

type CardGlowProps = { poster: Poster; index: number; pos: MotionValue<number> };

/** Coloured light the active poster throws onto the paper around it. */
export const CardGlow = memo(function CardGlow({ poster, index, pos }: CardGlowProps) {
  const opacity = useTransform(pos, (value) => activeWeight(index, value) * 0.42);
  return (
    <motion.div
      className={styles.glow}
      style={{
        top: slotTop(index) + CARD_H / 2 - 210,
        opacity,
        backgroundImage: `radial-gradient(closest-side, ${poster.glow}, transparent)`,
      }}
    />
  );
});
