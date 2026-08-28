import type { Metadata, Viewport } from "next";
import { Sora, Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Sora (display) + Inter (text) are the two families the Figma screens were
 * drawn in — every screen in the app already reaches for `font-sora` /
 * `font-inter`. Until these were loaded here and registered as `--font-sora`
 * / `--font-inter` in @kiakia/ui/tokens.css, Tailwind emitted no rule for
 * either utility and all ~590 usages silently fell through to Geist.
 */
const sora = Sora({
  variable: "--font-sora-face",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter-face",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "KiaKia — Food & goods delivery",
    template: "%s · KiaKia",
  },
  description:
    "Order food and goods from vendors near you, delivered kia kia — with your payment held in escrow until it reaches your hand.",
};

export const viewport: Viewport = {
  themeColor: "#B61913",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${sora.variable} ${inter.variable} ${geistMono.variable}`}
    >
      <body className="flex min-h-screen flex-col antialiased">{children}</body>
    </html>
  );
}
