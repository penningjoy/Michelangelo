import { z } from "zod";

const httpUrlSchema = z.string().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}, "URL must use http or https.");

export const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: httpUrlSchema,
  excerpt: z.string().min(1),
  reason: z.string().min(1)
});

export const coreSchema = z.object({
  essence: z.string().min(1),
  explanation: z.string().min(1)
});

export const analogySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  whyItWorks: z.string().min(1)
});

export const parallelSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1),
  concept: z.string().min(1),
  connection: z.string().min(1),
  caveat: z.string().min(1).optional()
});

export const applicationSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1),
  use: z.string().min(1),
  example: z.string().min(1)
});

export const unexploredSchema = z.object({
  id: z.string().min(1),
  idea: z.string().min(1),
  whyItMatters: z.string().min(1),
  suggestedNextStep: z.string().min(1).optional()
});

export const founderOpportunitySchema = z.object({
  id: z.string().min(1),
  productIdea: z.string().min(1),
  targetUser: z.string().min(1),
  painPoint: z.string().min(1),
  oneWeekMvp: z.string().min(1),
  successSignal: z.string().min(1),
  failureMode: z.string().min(1),
  nextExperiment: z.string().min(1)
});

export const founderModeSchema = z.object({
  opportunities: z.array(founderOpportunitySchema).min(1).max(8)
});

export const pedagogicalClaimSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1)
});

export const researchArtifactsSchema = z.object({
  summary: z.object({
    title: z.string().min(1),
    framing: z.string().min(1)
  }),
  core: coreSchema,
  analogies: z.array(analogySchema).max(12).default([]),
  parallels: z.array(parallelSchema).max(12).default([]),
  applications: z.array(applicationSchema).max(12).default([]),
  unexplored: z.array(unexploredSchema).max(12).default([]),
  claims: z.array(pedagogicalClaimSchema).max(16).default([]),
  concepts: z.array(z.string().min(1)).min(1).max(20),
  sources: z.array(sourceSchema).min(1).max(20),
  founderMode: founderModeSchema.optional()
});

export const generatedResearchArtifactsSchema = z.object({
  summary: z.object({
    title: z.string().min(1),
    framing: z.string().min(1)
  }),
  core: coreSchema,
  analogies: z.array(analogySchema).max(5).default([]),
  parallels: z.array(parallelSchema).max(5).default([]),
  applications: z.array(applicationSchema).max(5).default([]),
  unexplored: z.array(unexploredSchema).max(4).default([]),
  claims: z.array(pedagogicalClaimSchema).max(6).default([]),
  concepts: z.array(z.string().min(1)).max(10).default([]),
  sources: z.array(sourceSchema).max(8).default([]),
  founderMode: founderModeSchema.optional()
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

export const generatedResearchResultSchema = z.object({
  answer: z.string().min(1),
  artifacts: generatedResearchArtifactsSchema,
  compact: compactSummarySchema.optional()
});

export const researchDepthSchema = z.enum(["quick", "standard", "deep"]);

export const researchRequestSchema = z.object({
  apiKey: z.string().optional(),
  prompt: z.string().min(2).max(6000),
  sessionId: z.string().optional(),
  depth: researchDepthSchema.optional(),
  forceFounderMode: z.boolean().optional()
});

export type ResearchResult = z.infer<typeof researchResultSchema>;
export type CompactSummary = z.infer<typeof compactSummarySchema>;
