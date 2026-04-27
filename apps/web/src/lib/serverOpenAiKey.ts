import { getServerEnv } from "./serverEnv";

/**
 * OPENAI_API_KEY from the environment, or parsed from a nearby `.env` when the app runs in a
 * monorepo (`cwd` may be `apps/web` or the repo root). Next does not always load parent `.env`
 * files into API routes.
 */
export function getServerOpenAiKey(): string | undefined {
  return getServerEnv("OPENAI_API_KEY");
}
