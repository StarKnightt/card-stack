import type { PosterUniforms } from "@/components/card-stack/posters";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shader";

export type TargetOptions = {
  /** Device pixels the canvas covers on screen at full quality. */
  width: number;
  height: number;
  /**
   * Render resolution relative to that size, per axis. 1 is pixel-exact; strips
   * and flipped cards are squashed on screen, so they render at their displayed density.
   */
  qualityX: number;
  qualityY: number;
  /** Minimum milliseconds between content updates. */
  interval: number;
  /** Seconds added to the shared clock so posters never move in lockstep. */
  timeOffset: number;
  /** Multiplier on the poster's grain amount. */
  grain: number;
};

type Target = TargetOptions & {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  uniforms: PosterUniforms;
  lastRender: number;
  onFirstFrame: (() => void) | null;
};

export type TargetHandle = {
  update(options: Partial<TargetOptions>): void;
  dispose(): void;
};

type Locations = Record<
  "res" | "aspect" | "time" | "seed" | "mode" | "lin" | "lab" | "grain",
  WebGLUniformLocation | null
>;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create shader");
  gl.shaderSource(shader, source.trim());
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

const pixelSize = (target: TargetOptions) => ({
  width: Math.max(1, Math.round(target.width * target.qualityX)),
  height: Math.max(1, Math.round(target.height * target.qualityY)),
});

/**
 * One WebGL2 context renders every poster: each target is drawn at its own
 * pixel size into the shared drawing buffer and copied into its 2D canvas.
 */
class PosterRenderer {
  private readonly glCanvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext | null = null;
  private locations: Locations | null = null;
  private readonly targets = new Set<Target>();
  private solo: Target | null = null;
  private frame = 0;
  private clock = 0;
  private lastTick = 0;
  private timeScale = 1;
  private pageHidden = typeof document !== "undefined" && document.hidden;

  constructor() {
    this.glCanvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.gl = null;
      this.locations = null;
    });
    this.glCanvas.addEventListener("webglcontextrestored", () => {
      this.init();
      this.renderAll(performance.now(), true);
    });
    document.addEventListener("visibilitychange", () => {
      this.pageHidden = document.hidden;
      this.schedule();
    });
    this.init();
  }

  get supported() {
    return this.gl !== null;
  }

  private init() {
    const gl = this.glCanvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "default",
    });
    if (!gl) return;

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.bindAttribLocation(program, 0, "a_position");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const at = (name: string) => gl.getUniformLocation(program, name);
    this.locations = {
      res: at("u_res"),
      aspect: at("u_aspect"),
      time: at("u_time"),
      seed: at("u_seed"),
      mode: at("u_mode"),
      lin: at("u_lin"),
      lab: at("u_lab"),
      grain: at("u_grain"),
    };
    this.gl = gl;
  }

  /** 0 freezes every poster (reduced motion), 1 is the designed speed. */
  setTimeScale(scale: number) {
    this.timeScale = scale;
  }

  /** Render only this target (e.g. the expanded poster) until cleared. */
  setSolo(handle: TargetHandle | null) {
    this.solo = handle ? (handles.get(handle) ?? null) : null;
  }

  register(
    canvas: HTMLCanvasElement,
    uniforms: PosterUniforms,
    options: TargetOptions,
    drawNow: boolean,
    onFirstFrame?: () => void,
  ): TargetHandle {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    const target: Target = {
      ...options,
      canvas,
      ctx,
      uniforms,
      lastRender: -Infinity,
      onFirstFrame: onFirstFrame ?? null,
    };
    this.targets.add(target);
    if (drawNow) this.draw(target, performance.now());
    this.schedule();

    const handle: TargetHandle = {
      update: (next) => {
        const before = pixelSize(target);
        Object.assign(target, next);
        const after = pixelSize(target);
        // Draw a resized target right away rather than showing a cleared canvas for a frame.
        if (before.width !== after.width || before.height !== after.height) {
          this.draw(target, performance.now());
        }
      },
      dispose: () => {
        this.targets.delete(target);
        if (this.solo === target) this.solo = null;
        handles.delete(handle);
      },
    };
    handles.set(handle, target);
    return handle;
  }

  private schedule() {
    if (this.frame || this.pageHidden || this.targets.size === 0) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.frame = 0;
    if (this.pageHidden || this.targets.size === 0) return;
    this.renderAll(now, false);
    this.schedule();
  };

  private renderAll(now: number, force: boolean) {
    if (this.lastTick) this.clock += (Math.min(now - this.lastTick, 100) / 1000) * this.timeScale;
    this.lastTick = now;
    for (const target of this.targets) {
      if (this.solo && target !== this.solo) continue;
      if (force || now - target.lastRender >= target.interval - 2) this.draw(target, now);
    }
  }

  private draw(target: Target, now: number) {
    const { gl, locations } = this;
    if (!gl || !locations || gl.isContextLost()) return;

    const { width, height } = pixelSize(target);
    if (this.glCanvas.width < width || this.glCanvas.height < height) {
      this.glCanvas.width = Math.max(this.glCanvas.width, width);
      this.glCanvas.height = Math.max(this.glCanvas.height, height);
    }
    if (target.canvas.width !== width || target.canvas.height !== height) {
      target.canvas.width = width;
      target.canvas.height = height;
    }

    const { uniforms } = target;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(locations.res, width, height);
    gl.uniform1f(locations.aspect, target.width / target.height);
    gl.uniform1f(locations.time, this.clock + target.timeOffset);
    gl.uniform1f(locations.seed, uniforms.seed);
    gl.uniform1i(locations.mode, uniforms.mode);
    gl.uniform3fv(locations.lin, uniforms.linear);
    gl.uniform3fv(locations.lab, uniforms.oklab);
    gl.uniform1f(locations.grain, uniforms.grain * target.grain);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    target.ctx.drawImage(
      this.glCanvas,
      0,
      this.glCanvas.height - height,
      width,
      height,
      0,
      0,
      width,
      height,
    );
    target.lastRender = now;
    if (target.onFirstFrame) {
      const done = target.onFirstFrame;
      target.onFirstFrame = null;
      done();
    }
  }
}

const handles = new WeakMap<TargetHandle, Target>();
let renderer: PosterRenderer | null | undefined;

/** The shared renderer, or null when WebGL2 is unavailable (CSS fallbacks stay visible). */
export function getPosterRenderer(): PosterRenderer | null {
  if (renderer === undefined) {
    try {
      const instance = new PosterRenderer();
      renderer = instance.supported ? instance : null;
    } catch (error) {
      console.error(error);
      renderer = null;
    }
  }
  return renderer;
}
