import OpenAI from "openai";
import { researchResultSchema, type ResearchResult } from "./schemas";
import type { ChatMessage, InsightArtifact, ResearchArtifacts, TurnSummary } from "./types";

type ResearchInput = {
  apiKey: string;
  prompt: string;
  priorMessages: Pick<ChatMessage, "role" | "content">[];
  priorArtifacts?: ResearchArtifacts | null;
  priorTurnSummaries?: TurnSummary[];
  crossDomainBlock?: string;
};

export type StreamEvent =
  | { type: "answer-delta"; text: string }
  | { type: "complete"; result: ResearchResult };

const DEFAULT_MODEL = "gpt-5.2";
const SEPARATOR = "<<<ARTIFACTS>>>";

const INSTRUCTIONS = [
  "You are Michelangelo, a careful research assistant.",
  "You are in an ongoing research session with the user.",
  "Prior turns and prior artifacts from this session are included below.",
  "Build on them. Do not restart from scratch on each turn.",
  "When the user asks a follow-up, extend existing insights and sources where they apply — reference prior source IDs (e.g. src-1) rather than renaming them.",
  "Only introduce new sources or insights when the current question genuinely requires them.",
  "Use web search when useful. Sources must be real URLs.",
  "Do not overstate analogies. Every insight needs a caveat.",
  "Every insight needs a short list of concepts (kebab-case subjects, ≤5) — the cross-domain primitives that link this work to prior/future sessions.",
  "Mark EXACTLY ONE insight in the turn with `staked: true` — the single claim you would stake the turn on. All others: `staked: false`.",
  "When an insight's evidenceLevel is \"direct\", include a `supportingQuote` (≤200 chars) that is a VERBATIM substring of one of its cited sources' `excerpt` fields. Otherwise omit supportingQuote.",
  "",
  "Writing style for the answer (before the marker):",
  "  - The FIRST sentence must be the single strongest conclusion — written as a standalone claim, in the voice of a research essay. It should match the staked insight's claim in substance.",
  "  - After the lead sentence, 2–5 sentences of elaboration that weave the secondary insights into prose. Do not enumerate insights as bullets.",
  "  - Cite sources inline using bracket marks like [src-1] immediately after the clause they support. Use the same source IDs you define in the JSON tail. Multiple citations on one clause: [src-1][src-2].",
  "  - Tone is a careful essayist, not a chatbot. No markdown. No headings. No bullet lists.",
  "",
  "Respond in TWO PARTS, in this exact order:",
  "  1. The answer as described above. No markdown, no JSON.",
  `  2. On its own line, the exact marker: ${SEPARATOR}`,
  "  3. After the marker, strict JSON with two top-level keys \"artifacts\" and \"compact\". No markdown fences.",
  "The JSON shape must be:",
  "{",
  "  \"artifacts\": {",
  "    \"summary\": { \"title\": \"short title\", \"framing\": \"plain-language framing\" },",
  "    \"sources\": [ { \"id\": \"src-1\", \"title\": \"...\", \"url\": \"https://...\", \"excerpt\": \"...\", \"reason\": \"...\" } ],",
  "    \"insights\": [ { \"id\": \"ins-1\", \"claim\": \"...\", \"evidenceLevel\": \"direct|strong|tentative|speculative\", \"sourceIds\": [\"src-1\"], \"caveat\": \"...\", \"concepts\": [\"concept-a\", \"concept-b\"], \"staked\": false, \"supportingQuote\": \"optional verbatim excerpt\" } ],",
  "    \"caveats\":  [ { \"id\": \"cav-1\", \"text\": \"...\", \"severity\": \"low|medium|high\" } ]",
  "  },",
  "  \"compact\": {",
  "    \"gist\": \"one-line human-readable reminder of what this turn was about (≤280 chars)\",",
  "    \"keyClaims\": [\"≤4 short phrases, each ≤140 chars\"]",
  "  }",
  "}",
  "Use 3 to 5 sources, 3 to 5 insights, 2 to 4 caveats."
].join("\n");

/**
 * Stream a research turn. Yields answer deltas as the model writes the plain-text
 * answer, then a single "complete" event with the fully parsed ResearchResult
 * once the JSON tail is received.
 */
export async function* streamResearchResult(input: ResearchInput): AsyncGenerator<StreamEvent> {
  if (isMockMode(input.apiKey)) {
    const result = mockResearchResult(input.prompt);
    for (const chunk of chunkText(result.answer)) {
      yield { type: "answer-delta", text: chunk };
      await delay(12);
    }
    yield { type: "complete", result };
    return;
  }

  const client = new OpenAI({ apiKey: input.apiKey });
  const stream = await client.responses.stream({
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
    instructions: INSTRUCTIONS,
    input: buildPrompt(input)
  });

  let buffer = "";
  let emittedLen = 0;
  let inAnswer = true;

  for await (const event of stream) {
    if (event.type !== "response.output_text.delta") continue;
    buffer += event.delta;

    if (!inAnswer) continue;

    const sepIdx = buffer.indexOf(SEPARATOR);
    if (sepIdx !== -1) {
      if (emittedLen < sepIdx) {
        yield { type: "answer-delta", text: buffer.slice(emittedLen, sepIdx) };
        emittedLen = sepIdx;
      }
      inAnswer = false;
      continue;
    }

    // Hold back the tail in case it's the start of a partial separator.
    const safeEnd = buffer.length - (SEPARATOR.length - 1);
    if (safeEnd > emittedLen) {
      yield { type: "answer-delta", text: buffer.slice(emittedLen, safeEnd) };
      emittedLen = safeEnd;
    }
  }

  const sepIdx = buffer.indexOf(SEPARATOR);
  let answerText: string;
  let tailJson: string;

  if (sepIdx >= 0) {
    answerText = buffer.slice(0, sepIdx).trim();
    tailJson = buffer.slice(sepIdx + SEPARATOR.length).trim();
    if (inAnswer && emittedLen < sepIdx) {
      yield { type: "answer-delta", text: buffer.slice(emittedLen, sepIdx) };
    }
  } else {
    // Model didn't emit the separator. Fall back to pre-marker behaviour:
    // treat the whole response as JSON per the old contract.
    answerText = "";
    tailJson = buffer;
    if (inAnswer && emittedLen < buffer.length) {
      // We may have emitted partial garbage; don't emit more — the fallback
      // path will populate answer from the JSON.
    }
  }

  const parsed = parseJsonObject(tailJson) as Record<string, unknown>;
  const artifactsOnly = "artifacts" in parsed && !("answer" in parsed);
  const combined = artifactsOnly
    ? {
        answer: answerText || "(No answer provided.)",
        artifacts: parsed.artifacts,
        compact: parsed.compact
      }
    : parsed;

  const parsedResult = researchResultSchema.parse(combined);
  const result = enforceStakedAndGrounding(parsedResult);

  // If the client never saw answer deltas (fallback path), flush the final answer now.
  if (!inAnswer || answerText) {
    // deltas already sent during streaming
  } else if (result.answer) {
    yield { type: "answer-delta", text: result.answer };
  }

  yield { type: "complete", result };
}

/** Non-streaming wrapper, kept for callers/tests that don't need streaming. */
export async function generateResearchResult(input: ResearchInput): Promise<ResearchResult> {
  for await (const event of streamResearchResult(input)) {
    if (event.type === "complete") return event.result;
  }
  throw new Error("Stream ended without a complete result.");
}

function buildPrompt(input: ResearchInput): string {
  const priorTurns = input.priorMessages.slice(-8);
  const transcript = priorTurns.length
    ? priorTurns
        .map((message, index) => {
          const turnIndex = priorTurns.length - index;
          const role = message.role === "assistant" ? "Assistant" : "User";
          return `[${role}, turn t-${turnIndex}]\n${message.content}`;
        })
        .join("\n\n")
    : "None — this is the first turn.";

  const summaries = (input.priorTurnSummaries ?? [])
    .slice()
    .sort((a, b) => a.turnIndex - b.turnIndex)
    .map((summary) => {
      const claims = summary.keyClaims.map((claim) => `    • ${claim}`).join("\n");
      return `[turn ${summary.turnIndex}] ${summary.gist}${claims ? `\n${claims}` : ""}`;
    })
    .join("\n\n");

  const artifacts = input.priorArtifacts ? JSON.stringify(input.priorArtifacts).slice(0, 4000) : "";

  const crossDomain = input.crossDomainBlock ? `\n${input.crossDomainBlock}\n` : "";

  return `
Compact summaries of older turns (use for context, not to replace):
${summaries || "None."}

Full artifacts from the most recent turn (extend these rather than replacing them when the follow-up applies):
${artifacts || "None"}

Session transcript (prior turns only):
${transcript}
${crossDomain}
[User, now] — respond to this:
${input.prompt}
`;
}

function isMockMode(apiKey: string): boolean {
  return process.env.MOCK_MODEL === "true" || apiKey === "sk-mock";
}

function mockResearchResult(prompt: string): ResearchResult {
  return {
    answer:
      "The smallest proof of a research workspace is chat plus durable artifacts, not a full visual atlas [src-1]. From that base, user-owned API keys quietly reduce launch friction for a private MVP [src-1], and the structured output becomes the product surface that distinguishes the app from generic chat [src-2]. The rest is scaffolding — persistence, streaming, and a careful schema [src-3].",
    artifacts: {
      summary: {
        title: prompt.slice(0, 80) || "Research question",
        framing:
          "The useful MVP question is whether chat can reliably produce structured, inspectable research artifacts rather than a disposable answer."
      },
      sources: [
        {
          id: "src-1",
          title: "OpenAI Responses API documentation",
          url: "https://platform.openai.com/docs/api-reference/responses",
          excerpt: "Responses can generate model output and support tools such as web search.",
          reason: "It anchors the MVP provider path."
        },
        {
          id: "src-2",
          title: "Vercel Next.js documentation",
          url: "https://vercel.com/docs/frameworks/nextjs",
          excerpt: "Next.js apps deploy directly on Vercel with API routes and server rendering.",
          reason: "It anchors the deployment path."
        },
        {
          id: "src-3",
          title: "PostgreSQL documentation",
          url: "https://www.postgresql.org/docs/",
          excerpt: "Postgres stores relational records for sessions, messages, and artifacts.",
          reason: "It anchors persistence."
        }
      ],
      insights: [
        {
          id: "ins-1",
          claim: "The smallest proof is chat plus durable artifacts, not a full visual atlas.",
          evidenceLevel: "strong",
          sourceIds: ["src-1", "src-2"],
          caveat: "A mocked provider proves UI flow, but not research quality.",
          concepts: ["research-artifacts", "mvp-scope"],
          staked: true
        },
        {
          id: "ins-2",
          claim: "User-owned API keys reduce launch friction for a private MVP.",
          evidenceLevel: "tentative",
          sourceIds: ["src-1"],
          caveat: "The UX must be explicit that keys are never stored server-side.",
          concepts: ["byok", "launch-friction"],
          staked: false
        },
        {
          id: "ins-3",
          claim: "Artifacts should be the product surface that distinguishes this from generic chat.",
          evidenceLevel: "direct",
          sourceIds: ["src-1"],
          caveat: "The schema must stay simple enough for reliable model output.",
          supportingQuote: "Responses can generate model output",
          concepts: ["product-surface", "structured-output"],
          staked: false
        }
      ],
      caveats: [
        {
          id: "cav-1",
          text: "Citation quality depends on the model and search provider.",
          severity: "high"
        },
        {
          id: "cav-2",
          text: "No app-level authentication exists in the MVP; deployment protection handles private access.",
          severity: "medium"
        }
      ]
    },
    compact: {
      gist: "Framed Michelangelo MVP as chat + durable artifacts with BYOK.",
      keyClaims: [
        "Smallest proof is chat + artifacts",
        "BYOK reduces friction",
        "Artifacts are the product surface"
      ]
    }
  };
}

/**
 * Post-parse invariants:
 *  - Exactly one insight has staked = true. If zero or multiple, pick the first
 *    direct/strong insight or fall back to the first.
 *  - For evidenceLevel === "direct": supportingQuote must be a verbatim substring
 *    of at least one cited source's excerpt. If not, downgrade to "tentative"
 *    and drop the quote.
 */
export function enforceStakedAndGrounding(result: ResearchResult): ResearchResult {
  const insights = result.artifacts.insights.map((insight) => ({ ...insight })) as InsightArtifact[];
  const sources = result.artifacts.sources;
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  for (const insight of insights) {
    if (insight.evidenceLevel !== "direct") {
      delete insight.supportingQuote;
      continue;
    }
    const quote = insight.supportingQuote?.trim();
    if (!quote) {
      insight.evidenceLevel = "tentative";
      continue;
    }
    const grounded = insight.sourceIds.some((id) => {
      const src = sourceById.get(id);
      return src ? src.excerpt.includes(quote) : false;
    });
    if (!grounded) {
      insight.evidenceLevel = "tentative";
      delete insight.supportingQuote;
    }
  }

  const staked = insights.filter((insight) => insight.staked);
  if (staked.length !== 1) {
    insights.forEach((insight) => {
      insight.staked = false;
    });
    const pick =
      insights.find((insight) => insight.evidenceLevel === "direct") ??
      insights.find((insight) => insight.evidenceLevel === "strong") ??
      insights[0];
    if (pick) pick.staked = true;
  }

  return {
    ...result,
    artifacts: { ...result.artifacts, insights }
  };
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model did not return a JSON object.");
  }
}

function chunkText(text: string): string[] {
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    current += word;
    if (current.length >= 20) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
