import { hexToLinear, linearToOklab } from "@/lib/color";

const ShaderMode = {
  mesh: 0,
  aurora: 1,
  neon: 2,
  sunset: 3,
  holo: 4,
  silk: 5,
  flow: 6,
  waves: 7,
} as const;

type ShaderModeName = keyof typeof ShaderMode;

export type Poster = {
  id: string;
  title: string;
  collection: string;
  mode: ShaderModeName;
  /** Five sRGB stops. Their role depends on the mode (see lib/gl/shader.ts). */
  palette: [string, string, string, string, string];
  /** Colour of the light the poster casts on the paper. */
  glow: string;
  seed: number;
  grain: number;
};

export const POSTERS: readonly Poster[] = [
  {
    id: "last-light",
    title: "Last Light",
    collection: "Afterglow",
    mode: "sunset",
    palette: ["#2b0b3f", "#8a1f5f", "#ec4a57", "#ff9440", "#ffd98a"],
    glow: "#ff7a45",
    seed: 1.7,
    grain: 0.025,
  },
  {
    id: "violet-hour",
    title: "Violet Hour",
    collection: "Night Signals",
    mode: "neon",
    palette: ["#07041a", "#1c0a44", "#b44dff", "#ff4fd8", "#6c7bff"],
    glow: "#9b4dff",
    seed: 4.3,
    grain: 0.03,
  },
  {
    id: "peach-fuzz",
    title: "Peach Fuzz",
    collection: "Soft Matter",
    mode: "mesh",
    palette: ["#ff9b76", "#ffd2b4", "#fff3e4", "#f68db4", "#ffb35c"],
    glow: "#ffab8f",
    seed: 2.9,
    grain: 0.022,
  },
  {
    id: "aurora-drift",
    title: "Aurora Drift",
    collection: "Polar Studies",
    mode: "aurora",
    palette: ["#020b18", "#05293b", "#22f5c4", "#1ab3ff", "#7a5cff"],
    glow: "#1fd8c0",
    seed: 7.1,
    grain: 0.03,
  },
  {
    id: "liquid-chrome",
    title: "Liquid Chrome",
    collection: "Mercury",
    mode: "holo",
    palette: ["#f3f5fb", "#3b4250", "#ffb8ec", "#a8efff", "#e2ffb3"],
    glow: "#c3c8ff",
    seed: 5.6,
    grain: 0.022,
  },
  {
    id: "molten-core",
    title: "Molten Core",
    collection: "Foundry",
    mode: "flow",
    palette: ["#120302", "#4a0c04", "#b8300a", "#ff7a1a", "#ffe08a"],
    glow: "#ff6a1a",
    seed: 3.3,
    grain: 0.027,
  },
  {
    id: "rose-quartz",
    title: "Rose Quartz",
    collection: "Quiet Minerals",
    mode: "mesh",
    palette: ["#f4a3c4", "#cf86d6", "#ffe6ef", "#b39ff4", "#ffc1ae"],
    glow: "#f0a7c8",
    seed: 8.4,
    grain: 0.022,
  },
  {
    id: "blue-static",
    title: "Blue Static",
    collection: "Voltage",
    mode: "silk",
    palette: ["#010633", "#0420a8", "#1d5bff", "#8cbaff", "#f2f7ff"],
    glow: "#2d63ff",
    seed: 6.2,
    grain: 0.027,
  },
  {
    id: "acid-bloom",
    title: "Acid Bloom",
    collection: "Signal Garden",
    mode: "mesh",
    palette: ["#c8ff3a", "#1fdc95", "#f4ff86", "#0b9a7d", "#05624f"],
    glow: "#8cff3b",
    seed: 9.8,
    grain: 0.025,
  },
  {
    id: "deep-field",
    title: "Deep Field",
    collection: "Midnight Ink",
    mode: "flow",
    palette: ["#010208", "#0a1442", "#25409e", "#7a90f0", "#e6ebff"],
    glow: "#4258d6",
    seed: 1.2,
    grain: 0.03,
  },
  {
    id: "opaline",
    title: "Opaline",
    collection: "Prism Lab",
    mode: "waves",
    palette: ["#5b8fbf", "#9ccbe8", "#dff2fc", "#ffffff", "#9fe3ff"],
    glow: "#8fcff2",
    seed: 4.9,
    grain: 0.022,
  },
  {
    id: "infrared",
    title: "Infrared",
    collection: "Heat Map",
    mode: "aurora",
    palette: ["#110209", "#3c0a25", "#ff2c6e", "#ff8f3e", "#c33bff"],
    glow: "#ff3d6e",
    seed: 2.4,
    grain: 0.03,
  },
];

export type PosterUniforms = {
  mode: number;
  seed: number;
  grain: number;
  linear: Float32Array;
  oklab: Float32Array;
};

export function posterUniforms(poster: Poster): PosterUniforms {
  const linear = poster.palette.map(hexToLinear);
  return {
    mode: ShaderMode[poster.mode],
    seed: poster.seed,
    grain: poster.grain,
    linear: new Float32Array(linear.flat()),
    oklab: new Float32Array(linear.map(linearToOklab).flat()),
  };
}

/** CSS stand-in shown before the first WebGL frame (and if WebGL is unavailable). */
export function posterFallback({ mode, palette: [c0, c1, c2, c3, c4] }: Poster): string {
  if (mode === "sunset") {
    return `linear-gradient(180deg, ${c0} 0%, ${c1} 32%, ${c2} 56%, ${c3} 76%, ${c4} 100%)`;
  }
  return [
    `radial-gradient(90% 120% at 18% 26%, ${c2} 0%, transparent 62%)`,
    `radial-gradient(80% 110% at 84% 76%, ${c3} 0%, transparent 60%)`,
    `radial-gradient(70% 90% at 66% 12%, ${c4} 0%, transparent 56%)`,
    `linear-gradient(165deg, ${c0} 0%, ${c1} 100%)`,
  ].join(", ");
}
