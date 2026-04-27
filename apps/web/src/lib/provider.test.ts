import { describe, expect, it } from "vitest";
import { mergeResearchResult, parseJsonObject } from "./provider";
import type { ResearchArtifacts } from "./types";

describe("parseJsonObject", () => {
  it("parses a strict JSON object", () => {
    expect(parseJsonObject('{"answer":"ok"}')).toEqual({ answer: "ok" });
  });

  it("extracts a JSON object from surrounding text", () => {
    expect(parseJsonObject('prefix {"answer":"ok"} suffix')).toEqual({ answer: "ok" });
  });
});

describe("mergeResearchResult", () => {
  it("preserves summary and core on a narrow follow-up while enriching list sections", () => {
    const prior = makeArtifacts({
      summary: {
        title: "Entropy",
        framing: "Entropy is about how many microscopic arrangements fit the same macroscopic state."
      },
      core: {
        essence: "Entropy measures spread over possibilities.",
        explanation: "The more ways a state can be realized, the higher its entropy."
      },
      analogies: [
        {
          id: "ana-1",
          title: "Deck shuffle",
          description: "A shuffled deck can land in vastly more mixed arrangements than sorted ones.",
          whyItWorks: "Mixed states occupy more of the possibility space."
        }
      ],
      sources: [
        {
          id: "src-9",
          title: "Prior source",
          url: "https://example.com/entropy",
          excerpt: "Entropy counts compatible states.",
          reason: "Original grounding."
        }
      ]
    });

    const merged = mergeResearchResult(
      {
        answer: "A narrower application makes the same point concrete [src-1][src-2].",
        artifacts: makeArtifacts({
          summary: {
            title: "Entropy in product strategy",
            framing: "A broader reframing that should not win for a narrow prompt."
          },
          core: {
            essence: "A replacement essence that should not be used.",
            explanation: "A replacement explanation that should not be used."
          },
          analogies: [
            {
              id: "ana-2",
              title: "Messy closet",
              description: "A closet has far more messy configurations than tidy ones.",
              whyItWorks: "Disorder is combinatorially easier to realize."
            }
          ],
          applications: [
            {
              id: "app-1",
              domain: "operations",
              use: "warehouse monitoring",
              example: "Use entropy-like metrics to detect when stock placement becomes harder to predict."
            }
          ],
          sources: [
            {
              id: "src-1",
              title: "Same source, new id",
              url: "https://example.com/entropy",
              excerpt: "Duplicate evidence.",
              reason: "Should merge with the prior source."
            },
            {
              id: "src-2",
              title: "Fresh source",
              url: "https://example.com/warehouse",
              excerpt: "Operational example.",
              reason: "Adds the new application."
            }
          ]
        }),
        compact: {
          gist: "Entropy applied to operations.",
          keyClaims: ["Entropy can guide monitoring."]
        }
      },
      {
        priorArtifacts: prior,
        prompt: "Give me one more practical application."
      }
    );

    expect(merged.artifacts.summary).toEqual(prior.summary);
    expect(merged.artifacts.core).toEqual(prior.core);
    expect(merged.artifacts.analogies).toHaveLength(2);
    expect(merged.artifacts.applications).toHaveLength(1);
    expect(merged.artifacts.sources).toHaveLength(2);
    expect(merged.answer).toContain("[src-9]");
    expect(merged.answer).toContain("[src-2]");
  });

  it("updates founder mode only for founder-oriented follow-ups", () => {
    const prior = makeArtifacts({
      founderMode: {
        opportunities: [
          {
            id: "opp-1",
            productIdea: "Original idea",
            targetUser: "Researchers",
            painPoint: "They lose the thread between turns.",
            oneWeekMvp: "Save a stable concept board beside chat.",
            successSignal: "Users reopen and keep building it.",
            failureMode: "The board becomes stale.",
            nextExperiment: "Test with five returning users."
          }
        ]
      }
    });

    const nonFounder = mergeResearchResult(
      {
        answer: "More explanation, not more venture analysis.",
        artifacts: makeArtifacts({
          founderMode: {
            opportunities: [
              {
                id: "opp-2",
                productIdea: "New idea",
                targetUser: "Founders",
                painPoint: "They need faster GTM learning.",
                oneWeekMvp: "A dashboard.",
                successSignal: "More demos.",
                failureMode: "Too generic.",
                nextExperiment: "Talk to three buyers."
              }
            ]
          }
        }),
        compact: {
          gist: "General clarification.",
          keyClaims: []
        }
      },
      {
        priorArtifacts: prior,
        prompt: "Clarify the analogy in plain English."
      }
    );

    const founder = mergeResearchResult(
      {
        answer: "Now turn this into a founder-oriented opportunity map.",
        artifacts: makeArtifacts({
          founderMode: {
            opportunities: [
              {
                id: "opp-2",
                productIdea: "New idea",
                targetUser: "Founders",
                painPoint: "They need faster GTM learning.",
                oneWeekMvp: "A dashboard.",
                successSignal: "More demos.",
                failureMode: "Too generic.",
                nextExperiment: "Talk to three buyers."
              }
            ]
          }
        }),
        compact: {
          gist: "Founder mode.",
          keyClaims: []
        }
      },
      {
        priorArtifacts: prior,
        prompt: "Founder mode: what product should we build around this?"
      }
    );

    expect(nonFounder.artifacts.founderMode).toEqual(prior.founderMode);
    expect(founder.artifacts.founderMode?.opportunities).toHaveLength(2);
  });
});

function makeArtifacts(overrides: Partial<ResearchArtifacts> = {}): ResearchArtifacts {
  return {
    summary: {
      title: "Base title",
      framing: "Base framing"
    },
    core: {
      essence: "Base essence",
      explanation: "Base explanation"
    },
    analogies: [],
    parallels: [],
    applications: [],
    unexplored: [],
    claims: [],
    concepts: ["entropy", "probability"],
    sources: [
      {
        id: "src-1",
        title: "Base source",
        url: "https://example.com/base",
        excerpt: "Base excerpt",
        reason: "Base reason"
      }
    ],
    ...overrides
  };
}
