import OpenAI from "openai";
import {
  generatedResearchResultSchema,
  researchResultSchema,
  type ResearchResult
} from "./schemas";
import type {
  AnalogyArtifact,
  ApplicationArtifact,
  ChatMessage,
  FounderOpportunity,
  ParallelArtifact,
  PedagogicalClaim,
  ResearchArtifacts,
  ResearchDepth,
  SourceArtifact,
  TurnSummary,
  UnexploredArtifact
} from "./types";

type ResearchInput = {
  apiKey: string;
  prompt: string;
  priorMessages: Pick<ChatMessage, "role" | "content">[];
  priorArtifacts?: ResearchArtifacts | null;
  priorTurnSummaries?: TurnSummary[];
  crossDomainBlock?: string;
  depth?: ResearchDepth;
  forceFounderMode?: boolean;
};

export type StreamEvent =
  | { type: "answer-delta"; text: string }
  | { type: "complete"; result: ResearchResult };

const DEFAULT_MODEL = "gpt-5.2";
const SEPARATOR = "<<<ARTIFACTS>>>";

const INSTRUCTIONS = [
  "You are Michelangelo — a conversation-first concept studio for durable understanding.",
  "You help users understand concepts from computer science, information theory, and mathematics.",
  "You are not a source notebook. Sources are evidence in service of explanation, not the main object of the interface.",
  "Prior turns and prior artifacts from this session are included below; enrich them across turns.",
  "Do not restart from scratch unless the user asks for a new direction.",
  "If a follow-up is narrow, update only the sections that genuinely improve and leave the rest effectively unchanged.",
  "Keep explanations simple without dumbing them down.",
  "Use web search when useful. Sources must be real URLs.",
  "Favor interdisciplinary transfer and one vivid explanatory move when it clarifies the idea.",
  "Do not force analogies or parallels; only include ones that truly fit.",
  "Always include 2-10 kebab-case concepts for cross-session memory linking.",
  "",
  "Writing style for the answer (before the marker):",
  "  - Open with a framing line or hook that captures the idea.",
  "  - Continue with 2 to 4 short paragraphs of teacherly prose.",
  "  - Blend intuition, mechanism, and implications. Use one concrete analogy, scene, or example when it genuinely helps.",
  "  - End by pointing toward a frontier, consequence, or unresolved tension when useful.",
  "  - Cite sources inline using bracket marks like [src-1] immediately after supported clauses.",
  "  - Tone is precise, imaginative, and clear. No headings. No bullet lists. Paragraph breaks are good.",
  "",
  "Respond in TWO PARTS, in this exact order:",
  "  1. The answer as described above. No markdown, no JSON.",
  `  2. On its own line, the exact marker: ${SEPARATOR}`,
  "  3. After the marker, strict JSON with two top-level keys \"artifacts\" and \"compact\". No markdown fences.",
  "The JSON shape must be:",
  "{",
  "  \"artifacts\": {",
  "    \"summary\": { \"title\": \"short title\", \"framing\": \"plain-language framing\" },",
  "    \"core\": { \"essence\": \"...\", \"explanation\": \"...\" },",
  "    \"analogies\": [ { \"id\": \"ana-1\", \"title\": \"...\", \"description\": \"...\", \"whyItWorks\": \"...\" } ],",
  "    \"parallels\": [ { \"id\": \"par-1\", \"domain\": \"economics\", \"concept\": \"...\", \"connection\": \"...\", \"caveat\": \"optional\" } ],",
  "    \"applications\": [ { \"id\": \"app-1\", \"domain\": \"medicine\", \"use\": \"...\", \"example\": \"...\" } ],",
  "    \"unexplored\": [ { \"id\": \"unx-1\", \"idea\": \"...\", \"whyItMatters\": \"...\", \"suggestedNextStep\": \"optional\" } ],",
  "    \"claims\": [ { \"id\": \"clm-1\", \"claim\": \"short claim\" } ],",
  "    \"concepts\": [\"signal-to-noise\", \"feedback-loops\"],",
  "    \"sources\": [ { \"id\": \"src-1\", \"title\": \"...\", \"url\": \"https://...\", \"excerpt\": \"...\", \"reason\": \"...\" } ],",
  "    \"founderMode\": {",
  "      \"opportunities\": [",
  "        {",
  "          \"id\": \"opp-1\", \"productIdea\": \"...\", \"targetUser\": \"...\", \"painPoint\": \"...\",",
  "          \"oneWeekMvp\": \"...\", \"successSignal\": \"...\", \"failureMode\": \"...\", \"nextExperiment\": \"...\"",
  "        }",
  "      ]",
  "    }",
  "  },",
  "  \"compact\": {",
  "    \"gist\": \"one-line human-readable reminder of what this turn was about (≤280 chars)\",",
  "    \"keyClaims\": [\"≤4 short phrases, each ≤140 chars\"]",
  "  }",
  "}",
  "Treat the artifacts as a stable workspace: preserve strong prior material, add only what this turn improves, and avoid low-value repetition.",
  "Use 3 to 5 sources, 2 to 5 analogies, 3 to 5 parallels, 3 to 5 applications, and 2 to 4 unexplored items when they are warranted by the turn."
].join("\n");

const DEPTH_SUFFIX: Record<ResearchDepth, string> = {
  quick:
    "\n\nDepth: QUICK pass. Aim for 2 short paragraphs, 2-3 sources, and only the artifact sections that genuinely add value. Skip lists that would be filler.",
  standard: "",
  deep:
    "\n\nDepth: DEEP pass. Surface tensions and contrasting frames. Push for 4 short paragraphs, 4-5 strong sources, and at least 2 unexplored threads with concrete next steps. Prefer interdisciplinary parallels over restating the obvious."
};

function instructionsForDepth(depth: ResearchDepth | undefined): string {
  if (!depth || depth === "standard") return INSTRUCTIONS;
  return INSTRUCTIONS + DEPTH_SUFFIX[depth];
}

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
    instructions: instructionsForDepth(input.depth),
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

  const generated = generatedResearchResultSchema.parse(combined);
  const result = researchResultSchema.parse(
    mergeResearchResult(generated, {
      priorArtifacts: input.priorArtifacts,
      prompt: input.prompt,
      forceFounderMode: input.forceFounderMode
    })
  );

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

  const artifacts = input.priorArtifacts ? JSON.stringify(input.priorArtifacts).slice(0, 12_000) : "";

  const crossDomain = input.crossDomainBlock ? `\n${input.crossDomainBlock}\n` : "";

  return `
Compact summaries of older turns (use for context, not to replace):
${summaries || "None."}

Full artifacts from the current right-rail workspace (extend these rather than replacing them when the follow-up applies):
${artifacts || "None"}

Session transcript (prior turns only):
${transcript}
${crossDomain}
[User, now] — respond to this:
${input.prompt}
`;
}

export function mergeResearchResult(
  generated: ResearchResult,
  input: Pick<ResearchInput, "priorArtifacts" | "prompt" | "forceFounderMode">
): ResearchResult {
  const prior = input.priorArtifacts;
  if (!prior) {
    if (!input.forceFounderMode && generated.artifacts.founderMode && !isFounderModePrompt(input.prompt)) {
      return {
        ...generated,
        artifacts: { ...generated.artifacts, founderMode: undefined }
      };
    }
    return generated;
  }

  const { sources, sourceIdMap } = mergeSources(prior.sources, generated.artifacts.sources);
  const answer = remapSourceCitations(generated.answer, sourceIdMap);
  const shouldReframe = shouldRefreshCoreWorkspace(input.prompt, prior, generated.artifacts);
  const founderOriented = input.forceFounderMode === true || isFounderModePrompt(input.prompt);

  return {
    ...generated,
    answer,
    artifacts: {
      summary: shouldReframe ? generated.artifacts.summary : prior.summary,
      core: shouldReframe ? generated.artifacts.core : prior.core,
      analogies: mergeAnalogies(prior.analogies, generated.artifacts.analogies),
      parallels: mergeParallels(prior.parallels, generated.artifacts.parallels),
      applications: mergeApplications(prior.applications, generated.artifacts.applications),
      unexplored: mergeUnexplored(prior.unexplored, generated.artifacts.unexplored),
      claims: mergeClaims(prior.claims, generated.artifacts.claims),
      concepts: mergeConcepts(prior.concepts, generated.artifacts.concepts),
      sources,
      founderMode:
        founderOriented && generated.artifacts.founderMode
          ? {
              opportunities: mergeFounderOpportunities(
                prior.founderMode?.opportunities ?? [],
                generated.artifacts.founderMode.opportunities
              )
            }
          : prior.founderMode
    }
  };
}

function isMockMode(apiKey: string): boolean {
  return process.env.MOCK_MODEL === "true" || apiKey === "sk-mock";
}

function mockResearchResult(prompt: string): ResearchResult {
  return {
    answer:
      "A concept becomes durable when it stops feeling like a definition and starts behaving like a tool [src-1][src-2].\n\nMichelangelo should therefore teach by translation: explain the mechanism plainly, carry it into a concrete scene, then show how the same structure reappears in other domains [src-3]. That is how an abstract idea becomes something a user can notice and reuse.\n\nThe point is not to build a source notebook. The point is to help a conversation accumulate into a sharper mental model, with applications and open questions that keep the idea alive after the turn ends [src-1].",
    artifacts: {
      summary: {
        title: prompt.slice(0, 80) || "Research question",
        framing:
          "Great concept learning blends clarity, analogy, interdisciplinary transfer, and actionable experimentation."
      },
      core: {
        essence:
          "The best way to learn theory is to translate one abstract mechanism into many concrete contexts.",
        explanation:
          "When users can restate the concept plainly, recognize it in everyday systems, and apply it to real decisions, the theory becomes usable knowledge."
      },
      analogies: [
        {
          id: "ana-1",
          title: "Kitchen prep board",
          description:
            "A prep board groups ingredients by what dish they become, not by where they were bought.",
          whyItWorks:
            "This mirrors concept learning: organize by transferable function, not by textbook chapter."
        },
        {
          id: "ana-2",
          title: "Subway transfer map",
          description:
            "A subway map highlights transfer stations where routes intersect and choices expand.",
          whyItWorks:
            "Concepts with many cross-domain links are transfer stations for reasoning."
        }
      ],
      parallels: [
        {
          id: "par-1",
          domain: "economics",
          concept: "marginal analysis",
          connection: "Both systems improve when decisions are made on incremental impact, not totals."
        },
        {
          id: "par-2",
          domain: "history",
          concept: "path dependence",
          connection:
            "Early choices constrain future options in institutions and in technical systems alike.",
          caveat: "Human institutions also change from politics and culture, not only formal rules."
        },
        {
          id: "par-3",
          domain: "linguistics",
          concept: "compression in language",
          connection:
            "Both language and information systems encode frequent patterns efficiently."
        }
      ],
      applications: [
        {
          id: "app-1",
          domain: "product",
          use: "prioritization under uncertainty",
          example:
            "Choose roadmap experiments by expected information gain instead of loudest stakeholder demand."
        },
        {
          id: "app-2",
          domain: "healthcare",
          use: "clinical triage",
          example: "Tune thresholds by balancing false positives against missed urgent cases."
        },
        {
          id: "app-3",
          domain: "education",
          use: "curriculum sequencing",
          example: "Teach by concept dependency graph so each lesson unlocks multiple later topics."
        }
      ],
      unexplored: [
        {
          id: "unx-1",
          idea: "Which theoretical concepts are underused in startup discovery?",
          whyItMatters: "Undervalued concept frames can create strategic advantage.",
          suggestedNextStep: "Audit ten roadmap decisions and classify the reasoning model used."
        },
        {
          id: "unx-2",
          idea: "Can one shared concept map align engineering, design, and GTM decisions?",
          whyItMatters: "Shared abstractions reduce translation loss across functions."
        }
      ],
      claims: [
        {
          id: "clm-1",
          claim:
            "Concept exploration becomes sticky when each turn ends with concrete applications and next experiments."
        }
      ],
      concepts: ["concept-transfer", "cross-domain-mapping", "experimental-thinking"],
      founderMode: {
        opportunities: [
          {
            id: "opp-1",
            productIdea: "Theory-to-MVP copilot",
            targetUser: "early-stage founders",
            painPoint: "Good ideas stall between intellectual insight and execution.",
            oneWeekMvp: "Generate one experiment-ready brief from a concept each day.",
            successSignal: "At least 3 concept-derived experiments launched in a week.",
            failureMode: "Outputs may stay generic without concrete market context.",
            nextExperiment: "Pilot with 5 founders and compare launch cadence versus baseline."
          }
        ]
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

const MAX_ITEMS = {
  analogies: 8,
  parallels: 8,
  applications: 8,
  unexplored: 8,
  claims: 12,
  concepts: 16,
  sources: 16,
  founderOpportunities: 6
} as const;

function shouldRefreshCoreWorkspace(
  prompt: string,
  prior: ResearchArtifacts,
  next: ResearchArtifacts
): boolean {
  const normalizedPrompt = normalizeText(prompt);
  if (
    /(reframe|rethink|reinterpret|zoom out|big picture|broader|broaden|compare|versus|vs\.?|difference|relationship between|instead|not just|from the perspective|through the lens|step back)/.test(
      normalizedPrompt
    )
  ) {
    return true;
  }

  const priorConcepts = new Set(prior.concepts.map((concept) => concept.toLowerCase()));
  const nextConcepts = new Set(next.concepts.map((concept) => concept.toLowerCase()));
  const overlap = [...nextConcepts].filter((concept) => priorConcepts.has(concept)).length;
  const union = new Set([...priorConcepts, ...nextConcepts]).size;
  const overlapRatio = union === 0 ? 1 : overlap / union;

  return overlapRatio < 0.35 && normalizeText(prior.summary.title) !== normalizeText(next.summary.title);
}

function isFounderModePrompt(prompt: string): boolean {
  return /\b(founder|startup|product|mvp|go[- ]to[- ]market|gtm|pricing|customer|user acquisition|distribution|venture|saas|business model)\b/i.test(
    prompt
  );
}

function mergeAnalogies(prior: AnalogyArtifact[], next: AnalogyArtifact[]): AnalogyArtifact[] {
  return mergeItems(prior, next, {
    max: MAX_ITEMS.analogies,
    prefix: "ana",
    key: (item) => `${normalizeText(item.title)}|${normalizeText(item.description)}`,
    merge: (existing, incoming) => ({
      ...existing,
      title: preferRicherRequired(existing.title, incoming.title),
      description: preferRicherRequired(existing.description, incoming.description),
      whyItWorks: preferRicherRequired(existing.whyItWorks, incoming.whyItWorks)
    })
  });
}

function mergeParallels(prior: ParallelArtifact[], next: ParallelArtifact[]): ParallelArtifact[] {
  return mergeItems(prior, next, {
    max: MAX_ITEMS.parallels,
    prefix: "par",
    key: (item) => `${normalizeText(item.domain)}|${normalizeText(item.concept)}`,
    merge: (existing, incoming) => ({
      ...existing,
      connection: preferRicherRequired(existing.connection, incoming.connection),
      caveat: preferRicher(existing.caveat, incoming.caveat),
      domain: preferRicherRequired(existing.domain, incoming.domain),
      concept: preferRicherRequired(existing.concept, incoming.concept)
    })
  });
}

function mergeApplications(
  prior: ApplicationArtifact[],
  next: ApplicationArtifact[]
): ApplicationArtifact[] {
  return mergeItems(prior, next, {
    max: MAX_ITEMS.applications,
    prefix: "app",
    key: (item) => `${normalizeText(item.domain)}|${normalizeText(item.use)}`,
    merge: (existing, incoming) => ({
      ...existing,
      domain: preferRicherRequired(existing.domain, incoming.domain),
      use: preferRicherRequired(existing.use, incoming.use),
      example: preferRicherRequired(existing.example, incoming.example)
    })
  });
}

function mergeUnexplored(
  prior: UnexploredArtifact[],
  next: UnexploredArtifact[]
): UnexploredArtifact[] {
  return mergeItems(prior, next, {
    max: MAX_ITEMS.unexplored,
    prefix: "unx",
    key: (item) => normalizeText(item.idea),
    merge: (existing, incoming) => ({
      ...existing,
      idea: preferRicherRequired(existing.idea, incoming.idea),
      whyItMatters: preferRicherRequired(existing.whyItMatters, incoming.whyItMatters),
      suggestedNextStep: preferRicher(existing.suggestedNextStep, incoming.suggestedNextStep)
    })
  });
}

function mergeClaims(prior: PedagogicalClaim[], next: PedagogicalClaim[]): PedagogicalClaim[] {
  return mergeItems(prior, next, {
    max: MAX_ITEMS.claims,
    prefix: "clm",
    key: (item) => normalizeText(item.claim),
    merge: (existing, incoming) => ({
      ...existing,
      claim: preferRicherRequired(existing.claim, incoming.claim)
    })
  });
}

function mergeFounderOpportunities(
  prior: FounderOpportunity[],
  next: FounderOpportunity[]
): FounderOpportunity[] {
  return mergeItems(prior, next, {
    max: MAX_ITEMS.founderOpportunities,
    prefix: "opp",
    key: (item) => `${normalizeText(item.productIdea)}|${normalizeText(item.targetUser)}`,
    merge: (existing, incoming) => ({
      ...existing,
      productIdea: preferRicherRequired(existing.productIdea, incoming.productIdea),
      targetUser: preferRicherRequired(existing.targetUser, incoming.targetUser),
      painPoint: preferRicherRequired(existing.painPoint, incoming.painPoint),
      oneWeekMvp: preferRicherRequired(existing.oneWeekMvp, incoming.oneWeekMvp),
      successSignal: preferRicherRequired(existing.successSignal, incoming.successSignal),
      failureMode: preferRicherRequired(existing.failureMode, incoming.failureMode),
      nextExperiment: preferRicherRequired(existing.nextExperiment, incoming.nextExperiment)
    })
  });
}

function mergeConcepts(prior: string[], next: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const concept of [...prior, ...next]) {
    const normalized = concept.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(concept.trim());
    if (merged.length >= MAX_ITEMS.concepts) break;
  }
  return merged;
}

function mergeSources(
  prior: SourceArtifact[],
  next: SourceArtifact[]
): { sources: SourceArtifact[]; sourceIdMap: Map<string, string> } {
  const merged = prior.map((source) => ({ ...source }));
  const byKey = new Map(merged.map((source) => [sourceIdentity(source), source]));
  const usedIds = new Set(merged.map((source) => source.id));
  const sourceIdMap = new Map<string, string>();

  for (const source of next) {
    const key = sourceIdentity(source);
    const existing = byKey.get(key);
    if (existing) {
      existing.title = preferRicherRequired(existing.title, source.title);
      existing.excerpt = preferRicherRequired(existing.excerpt, source.excerpt);
      existing.reason = preferRicherRequired(existing.reason, source.reason);
      sourceIdMap.set(source.id, existing.id);
      continue;
    }

    const nextId = ensureUniqueId("src", source.id, usedIds);
    const item = { ...source, id: nextId };
    merged.push(item);
    byKey.set(key, item);
    usedIds.add(nextId);
    sourceIdMap.set(source.id, nextId);
    if (merged.length >= MAX_ITEMS.sources) break;
  }

  return { sources: merged, sourceIdMap };
}

function remapSourceCitations(answer: string, sourceIdMap: Map<string, string>): string {
  if (sourceIdMap.size === 0) return answer;
  return answer.replace(/\[(src-[\w-]+)\]/g, (full, srcId: string) => {
    const mapped = sourceIdMap.get(srcId);
    return mapped ? `[${mapped}]` : full;
  });
}

function mergeItems<T extends { id: string }>(
  prior: T[],
  next: T[],
  options: {
    max: number;
    prefix: string;
    key: (item: T) => string;
    merge: (existing: T, incoming: T) => T;
  }
): T[] {
  const merged = prior.map((item) => ({ ...item }));
  const byKey = new Map<string, T>();
  const usedIds = new Set<string>();

  for (const item of merged) {
    byKey.set(options.key(item), item);
    usedIds.add(item.id);
  }

  for (const incoming of next) {
    const key = options.key(incoming);
    const existing = byKey.get(key);
    if (existing) {
      Object.assign(existing, options.merge(existing, incoming));
      continue;
    }

    const nextId = ensureUniqueId(options.prefix, incoming.id, usedIds);
    const item = { ...incoming, id: nextId };
    merged.push(item);
    byKey.set(key, item);
    usedIds.add(nextId);
    if (merged.length >= options.max) break;
  }

  return merged;
}

function ensureUniqueId(prefix: string, desiredId: string, usedIds: Set<string>): string {
  if (!usedIds.has(desiredId)) return desiredId;
  let counter = usedIds.size + 1;
  let candidate = `${prefix}-${counter}`;
  while (usedIds.has(candidate)) {
    counter += 1;
    candidate = `${prefix}-${counter}`;
  }
  return candidate;
}

function sourceIdentity(source: SourceArtifact): string {
  return normalizeUrl(source.url);
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return normalizeText(url);
  }
}

function preferRicher(current?: string, incoming?: string): string | undefined {
  if (!incoming?.trim()) return current;
  if (!current?.trim()) return incoming.trim();
  return incoming.trim().length > current.trim().length ? incoming.trim() : current.trim();
}

function preferRicherRequired(current: string, incoming?: string): string {
  return preferRicher(current, incoming) ?? current;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s-]/g, "").trim();
}
