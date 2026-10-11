# Glow Deck

[![Glow Deck demo: hovering through the deck and expanding posters](docs/demo.webp)](docs/demo.mp4)

<sub>[Watch the full-quality demo (MP4, 22 s)](docs/demo.mp4)</sub>

An interactive 3D card stack of twelve live WebGL posters. Hover to flip through the deck, click a poster to expand it.

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Framer Motion and a single shared WebGL2 renderer.

## Features

- **Perspective deck.** Cards behind the active one sit higher, smaller and tilted away; the active card follows the cursor's height.
- **Steady hover scrubbing.** A hysteresis dead zone (30% of a card's hover band) keeps the active card from flickering when the cursor rests on a boundary.
- **Expand to a modal.** Click, Enter or Space opens the active poster in a centred view; Esc, a click or a tap closes it.
- **Every input.** Keyboard (↑ ↓ Home End Esc), mouse wheel and trackpad, touch swipe and tap.
- **Live shader posters.** Twelve GLSL posters (mesh gradients, aurora, neon, liquid chrome, molten flow, holographic waves and more) drawn by one WebGL2 context, with CSS gradient fallbacks.
- **Pixel-exact at rest.** Resting cards land on whole device pixels at any `devicePixelRatio`, and the film grain is static, so nothing blurs or shimmers.
- **Reduced motion.** With `prefers-reduced-motion`, posters freeze and transitions shorten.

## Getting started

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Deploying

Set `NEXT_PUBLIC_SITE_URL` to the site's public origin (for example `https://glow-deck.example.com`) so Open Graph and Twitter image URLs are absolute. Without it, Vercel deployments use the project's production URL (`VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`), and local builds use `http://localhost:3000`.

## Project structure

| Path | Contents |
| --- | --- |
| `app/` | Page, root layout and metadata, Open Graph/Twitter images, icons |
| `components/card-stack/` | Deck controller, cards, header, dot track, expanded poster, geometry, poster definitions |
| `lib/gl/` | Shared WebGL2 renderer and the poster shader |
| `scripts/` | Playwright scripts for verification and for regenerating media |
| `docs/` | Demo video, README preview, GitHub social preview image |
| `showcase/` | Screenshots and the crispness/flicker diagnostics |

## Verification scripts

The scripts drive a production build on port 3100 with Playwright (`pnpm build && pnpm start --port 3100`):

| Script | Checks |
| --- | --- |
| `node scripts/verify-hysteresis.mjs` | No flicker when wiggling on card boundaries; slow and fast hover passes |
| `node scripts/perf.mjs` | Frame rate and long tasks while idle, scrubbing and expanded |
| `node scripts/diagnose-crispness.mjs <label>` | Canvas-to-device-pixel mapping and resting-frame flicker |
| `node scripts/probe-pixels.mjs` | Pixel diff between the resting card on screen and its canvas |
| `node scripts/og-image.mjs` | Regenerates the social images from the live deck |
| `node scripts/icons.mjs` | Regenerates `favicon.ico` and `apple-icon.png` from `app/icon.svg` |

## Social preview

`docs/social-preview.png` (1280×640) is the GitHub social preview: upload it under **Settings → General → Social preview**.
