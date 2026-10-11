"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { posterUniforms, type Poster } from "@/components/card-stack/posters";
import { getPosterRenderer, type TargetHandle, type TargetOptions } from "./renderer";

/**
 * Registers a canvas with the shared poster renderer for as long as it is mounted.
 * `immediate` draws the first frame before the browser paints, for elements that
 * must look finished on their very first frame (the expanded poster).
 */
export function usePosterCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  poster: Poster,
  options: TargetOptions,
  immediate = false,
): RefObject<TargetHandle | null> {
  const handleRef = useRef<TargetHandle | null>(null);
  const optionsRef = useRef(options);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const renderer = getPosterRenderer();
    if (!canvas || !renderer) return;
    const handle = renderer.register(
      canvas,
      posterUniforms(poster),
      optionsRef.current,
      immediate,
      () => {
        canvas.dataset.ready = "";
      },
    );
    handleRef.current = handle;
    return () => {
      handle.dispose();
      handleRef.current = null;
    };
  }, [canvasRef, poster, immediate]);

  useEffect(() => {
    optionsRef.current = options;
    handleRef.current?.update(options);
  }, [options]);

  return handleRef;
}
