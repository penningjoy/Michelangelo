import { getServerOpenAiKey } from "../../../../lib/serverOpenAiKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lets the client skip the key gate when OPENAI_API_KEY is set on the server
 * (including repo-root `.env` in a monorepo).
 */
export function GET() {
  const hasServerApiKey = Boolean(getServerOpenAiKey());
  return Response.json({ hasServerApiKey });
}
