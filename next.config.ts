import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a production build/test server run beside the long-lived `next dev`
  // without sharing an output directory, e.g. `NEXT_DIST_DIR=.next-test pnpm build`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        // CSS modules must stay modules, so Tailwind only processes global stylesheets.
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
