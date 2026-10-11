import { CardStack } from "@/components/card-stack/card-stack";

export default function Home() {
  return (
    <main className="relative grid h-dvh place-items-center overflow-hidden">
      <CardStack />
      <p className="pointer-events-none absolute inset-x-0 bottom-7 text-center font-mono text-[10.5px] uppercase tracking-[0.26em] text-ink/35">
        <span className="hidden pointer-fine:inline">
          Hover or scroll to flip · Click to expand · ↑ ↓
        </span>
        <span className="pointer-fine:hidden">Swipe to flip · Tap to expand</span>
      </p>
    </main>
  );
}
