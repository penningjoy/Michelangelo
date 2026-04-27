import type { Metadata } from "next";
import { Fraunces, Manrope, Source_Serif_4 } from "next/font/google";
import "./styles.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["600", "700"]
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-reading",
  weight: ["400", "500", "600"]
});

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-ui",
  weight: ["400", "500", "600"]
});

export const metadata: Metadata = {
  title: "Michelangelo · Concept studio",
  description:
    "Conversation-first concept building with durable artifacts, grounded evidence, and cross-domain transfer."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${serif.variable} ${sans.variable}`}>
      <body className="atelier-body">
        {children}
        <a
          className="brand-mark"
          href="https://redlemon.org"
          aria-label="Red Lemon — nonprofit brand"
          title="Red Lemon"
          target="_blank"
          rel="noreferrer"
        >
          RL
        </a>
      </body>
    </html>
  );
}
