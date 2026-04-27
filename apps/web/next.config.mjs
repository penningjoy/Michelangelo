import path from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

// `next dev` runs with cwd `apps/web`; repo root is two levels up (not one: `apps/` is between).
const monorepoRoot = path.resolve(process.cwd(), "..", "..");
loadEnvConfig(monorepoRoot);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  devIndicators: false,
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self' https://api.openai.com https://*.openai.com",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "img-src 'self' data: https:",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "form-action 'self'",
      "upgrade-insecure-requests"
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
