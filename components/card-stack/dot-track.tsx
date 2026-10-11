"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { COUNT } from "./geometry";
import type { Poster } from "./posters";
import styles from "./card-stack.module.css";

type DotTrackProps = {
  posters: readonly Poster[];
  index: number;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
};

const STEP = 15;
const TOP = 4;

/** Dots run bottom (first card) to top (last card), matching the deck. */
const dotY = (i: number) => TOP + (COUNT - 1 - i) * STEP;

export function DotTrack({ posters, index, reducedMotion, onSelect }: DotTrackProps) {
  const y = useMotionValue(dotY(index));

  useEffect(() => {
    const controls = animate(
      y,
      dotY(index),
      reducedMotion
        ? { duration: 0.18, ease: "easeOut" }
        : { type: "spring", stiffness: 420, damping: 30, mass: 0.7 },
    );
    return () => controls.stop();
  }, [index, reducedMotion, y]);

  return (
    <nav className={styles.track} aria-label="Posters">
      <div className={styles.trackLine} />
      {posters.map((poster, i) => (
        <button
          key={poster.id}
          type="button"
          className={styles.dot}
          style={{ top: dotY(i) }}
          aria-label={`${poster.title}, ${i + 1} of ${COUNT}`}
          aria-current={i === index ? "true" : undefined}
          onClick={() => onSelect(i)}
        />
      ))}
      <motion.div className={styles.pill} style={{ y }} />
      <p className={styles.counter} aria-hidden>
        {String(index + 1).padStart(2, "0")} / {COUNT}
      </p>
    </nav>
  );
}
