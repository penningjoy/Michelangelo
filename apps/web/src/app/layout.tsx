import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./styles.css";

const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-reading",
  weight: ["400", "500", "600"]
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-ui",
  weight: ["400", "500", "600"]
});

export const metadata: Metadata = {
  title: "Michelangelo · Research workspace",
  description:
    "Cross-domain research with grounded answers, inspectable sources, and a growing concept memory."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
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
