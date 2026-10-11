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

/** Absolute origin for OG/Twitter image URLs: explicit setting, then Vercel's, then local dev. */
function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercelHost ? `https://${vercelHost}` : "http://localhost:3000";
}

const title = "Glow Deck — a stack of living posters";
const description =
  "Twelve live shader posters in a 3D deck. Hover to flip through, click to expand.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title,
  description,
  applicationName: "Glow Deck",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Glow Deck",
    locale: "en_US",
    url: "/",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
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
