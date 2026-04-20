import { z } from "zod";

export const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  excerpt: z.string().min(1),
  reason: z.string().min(1)
});

export const insightSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  evidenceLevel: z.enum(["direct", "strong", "tentative", "speculative"]),
  sourceIds: z.array(z.string()).default([]),
  caveat: z.string().min(1),
  concepts: z.array(z.string().min(1)).max(5).default([]),
  staked: z.boolean().default(false),
  /** When evidenceLevel === "direct", must contain a verbatim substring of a cited source's excerpt. */
  supportingQuote: z.string().max(200).optional()
});

export const caveatSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  severity: z.enum(["low", "medium", "high"])
});

export const researchArtifactsSchema = z.object({
  summary: z.object({
    title: z.string().min(1),
    framing: z.string().min(1)
  }),
  sources: z.array(sourceSchema).min(1).max(8),
  insights: z.array(insightSchema).min(1).max(6),
  caveats: z.array(caveatSchema).min(1).max(6)
});

export const compactSummarySchema = z.object({
  gist: z.string().min(1).max(280),
  keyClaims: z.array(z.string().min(1).max(140)).max(4).default([])
});

export const researchResultSchema = z.object({
  answer: z.string().min(1),
  artifacts: researchArtifactsSchema,
  compact: compactSummarySchema.optional()
});

export type ResearchResult = z.infer<typeof researchResultSchema>;
export type CompactSummary = z.infer<typeof compactSummarySchema>;
