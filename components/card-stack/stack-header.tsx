"use client";

import { AnimatePresence, motion, type Variants } from "framer-motion";
import type { Poster } from "./posters";
import styles from "./card-stack.module.css";

type StackHeaderProps = {
  poster: Poster;
  /** +1 when moving up the deck, -1 when moving down. */
  direction: number;
  reducedMotion: boolean;
};

type SwapContext = { direction: number; reducedMotion: boolean };

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

// The resting state is identical with and without reduced motion, so server and client markup match.
const swap: Variants = {
  enter: ({ direction, reducedMotion }: SwapContext) => ({
    opacity: 0,
    filter: reducedMotion ? "blur(0px)" : "blur(6px)",
    y: reducedMotion ? 0 : 9 * direction,
  }),
  center: ({ reducedMotion }: SwapContext) => ({
    opacity: 1,
    filter: "blur(0px)",
    y: 0,
    transition: { duration: reducedMotion ? 0.2 : 0.24, ease: EASE_OUT },
  }),
  exit: ({ direction, reducedMotion }: SwapContext) => ({
    opacity: 0,
    filter: reducedMotion ? "blur(0px)" : "blur(6px)",
    y: reducedMotion ? 0 : -7 * direction,
    transition: { duration: reducedMotion ? 0.14 : 0.16, ease: "easeIn" },
  }),
};

export function StackHeader({ poster, direction, reducedMotion }: StackHeaderProps) {
  const context: SwapContext = { direction, reducedMotion };
  return (
    <header className={styles.header} aria-hidden>
      <div className={styles.labelSlot}>
        <AnimatePresence initial={false} mode="popLayout" custom={context}>
          <motion.p
            key={poster.id}
            className={styles.label}
            custom={context}
            variants={swap}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {poster.collection}
          </motion.p>
        </AnimatePresence>
      </div>
      <div className={styles.titleSlot}>
        <AnimatePresence initial={false} mode="popLayout" custom={context}>
          <motion.p
            key={poster.id}
            className={styles.title}
            custom={context}
            variants={swap}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {poster.title}
          </motion.p>
        </AnimatePresence>
      </div>
    </header>
  );
}
