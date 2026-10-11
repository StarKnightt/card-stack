import type { Metadata, Viewport } from "next";
import { Fragment_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  axes: ["wdth"],
});

const fragmentMono = Fragment_Mono({
  variable: "--font-fragment-mono",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Glow Deck — a stack of living posters",
  description:
    "Twelve live shader posters in a 3D deck. Hover to flip through, click to expand.",
};

export const viewport: Viewport = {
  themeColor: "#f7f6f3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${fragmentMono.variable} h-full`}
    >
      {/* Extensions (e.g. ColorZilla) inject attributes into <body> before hydration. */}
      <body className="h-full font-display" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
