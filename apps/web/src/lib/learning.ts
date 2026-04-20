import type { ResearchArtifacts } from "./types";

export type RecallPrompt = {
  id: string;
  question: string;
  sampleAnswer: string;
  kind: "recall" | "transfer";
};

/**
 * Build a short recall drill from the current turn's artifacts.
 * Keeps output deterministic and cheap (no extra model call).
 */
export function buildRecallDrill(artifacts: ResearchArtifacts): RecallPrompt[] {
  const staked = artifacts.insights.find((insight) => insight.staked) ?? artifacts.insights[0];
  const secondary = artifacts.insights.filter((insight) => insight.id !== staked?.id).slice(0, 2);
  const firstCaveat = artifacts.caveats[0];

  const prompts: RecallPrompt[] = [];

  if (staked) {
    prompts.push({
      id: "recall-staked",
      kind: "recall",
      question: "Without looking back, what was the single strongest claim in this turn?",
      sampleAnswer: staked.claim
    });
  }

  secondary.forEach((insight, index) => {
    prompts.push({
      id: `recall-secondary-${index + 1}`,
      kind: "recall",
      question: `What supporting idea #${index + 1} helped justify the main claim?`,
      sampleAnswer: insight.claim
    });
  });

  if (firstCaveat) {
    prompts.push({
      id: "recall-caveat",
      kind: "recall",
      question: "What important caveat or limitation should you remember?",
      sampleAnswer: firstCaveat.text
    });
  }

  const conceptA = staked?.concepts[0] ?? artifacts.insights[0]?.concepts[0] ?? "core concept";
  const conceptB = staked?.concepts[1] ?? artifacts.insights[1]?.concepts[0] ?? "a new domain";
  prompts.push({
    id: "transfer-1",
    kind: "transfer",
    question: `How would you apply ${humanizeConcept(conceptA)} to ${humanizeConcept(conceptB)} in a practical product or engineering decision?`,
    sampleAnswer: `Use ${humanizeConcept(conceptA)} as the decision lens, then test tradeoffs in ${humanizeConcept(conceptB)} with explicit assumptions and measurable outcomes.`
  });

  return prompts.slice(0, 5);
}

function humanizeConcept(concept: string): string {
  return concept
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
