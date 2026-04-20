import path from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

// `next dev` runs with cwd `apps/web`; repo root is two levels up (not one: `apps/` is between).
const monorepoRoot = path.resolve(process.cwd(), "..", "..");
loadEnvConfig(monorepoRoot);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  devIndicators: false
};

export default nextConfig;
