import { requireDemoPrincipal } from "../../../../lib/demoAccess";
import { getServerEnv } from "../../../../lib/serverEnv";
import { getServerOpenAiKey } from "../../../../lib/serverOpenAiKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lets the client skip the key gate when OPENAI_API_KEY is set on the server
 * or mock mode is enabled (including repo-root `.env` in a monorepo).
 */
export function GET(request: Request) {
  const access = requireDemoPrincipal(request);
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }
  const hasServerApiKey = Boolean(getServerOpenAiKey());
  const hasServerMockMode = getServerEnv("MOCK_MODEL") === "true";
  return Response.json({ hasServerApiKey, hasServerMockMode });
}
