import fs from "node:fs";
import path from "node:path";

/**
 * OPENAI_API_KEY from the environment, or parsed from a nearby `.env` when the app runs in a
 * monorepo (`cwd` may be `apps/web` or the repo root). Next does not always load parent `.env`
 * files into API routes.
 */
export function getServerOpenAiKey(): string | undefined {
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, ".env.local"),
    path.join(cwd, ".env"),
    // From `apps/web`, one `..` is `apps/`, not the repo root — need `../..` for monorepo `.env`.
    path.join(cwd, "..", "..", ".env.local"),
    path.join(cwd, "..", "..", ".env"),
    path.join(cwd, "..", ".env.local"),
    path.join(cwd, "..", ".env"),
    path.join(cwd, "apps", "web", ".env.local"),
    path.join(cwd, "apps", "web", ".env")
  ];

  for (const filePath of candidates) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const line = raw.split("\n").find((l) => l.trimStart().startsWith("OPENAI_API_KEY="));
      if (!line) continue;
      const value = line.slice("OPENAI_API_KEY=".length).trim();
      const unquoted = value.replace(/^["']|["']$/g, "");
      if (unquoted) return unquoted;
    } catch {
      continue;
    }
  }

  return undefined;
}
