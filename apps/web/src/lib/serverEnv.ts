import fs from "node:fs";
import path from "node:path";

const ENV_FILE_CACHE = new Map<string, Map<string, string>>();

export function getServerEnv(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  if (isTestRuntime()) return undefined;

  for (const filePath of getEnvCandidates()) {
    const values = readEnvFile(filePath);
    const value = values.get(name);
    if (value) return value;
  }

  return undefined;
}

function getEnvCandidates(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, ".env.local"),
    path.join(cwd, ".env"),
    path.join(cwd, "..", "..", ".env.local"),
    path.join(cwd, "..", "..", ".env"),
    path.join(cwd, "..", ".env.local"),
    path.join(cwd, "..", ".env"),
    path.join(cwd, "apps", "web", ".env.local"),
    path.join(cwd, "apps", "web", ".env")
  ];
}

function readEnvFile(filePath: string): Map<string, string> {
  const cached = ENV_FILE_CACHE.get(filePath);
  if (cached) return cached;

  const values = new Map<string, string>();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key && value) values.set(key, value);
    }
  } catch {
    // Ignore missing or unreadable env files.
  }

  ENV_FILE_CACHE.set(filePath, values);
  return values;
}

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}
