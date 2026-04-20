export type Role = "user" | "assistant";

export type EvidenceLevel = "direct" | "strong" | "tentative" | "speculative";

export type SourceArtifact = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  reason: string;
};

export type InsightArtifact = {
  id: string;
  claim: string;
  evidenceLevel: EvidenceLevel;
  sourceIds: string[];
  caveat: string;
  concepts: string[];
  staked: boolean;
  supportingQuote?: string;
};

export type CaveatArtifact = {
  id: string;
  text: string;
  severity: "low" | "medium" | "high";
};

export type ResearchArtifacts = {
  summary: {
    title: string;
    framing: string;
  };
  sources: SourceArtifact[];
  insights: InsightArtifact[];
  caveats: CaveatArtifact[];
};

export type StoredArtifact = {
  id: string;
  sessionId: string;
  type: keyof ResearchArtifacts;
  content: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ConceptSpanForClient = {
  start: number;
  end: number;
  conceptLabel: string;
  priorSessionTitle?: string;
  priorTurnIndex?: number;
  priorClaim?: string;
};

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  /** Present when the assistant message has persisted cross-session concept underlines. */
  conceptSpans?: ConceptSpanForClient[];
};

export type SessionRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type TurnSummary = {
  id: string;
  sessionId: string;
  turnIndex: number;
  gist: string;
  keyClaims: string[];
  sourceIds: string[];
  insightIds: string[];
  createdAt: string;
};

export type ConceptRecord = {
  id: string;
  label: string;
  firstSeen: string;
  mentionCount: number;
};

export type ConceptMention = {
  conceptId: string;
  sessionId: string;
  insightId: string;
  turnIndex: number;
  createdAt: string;
};

export type ResearchEvent =
  | { type: "session"; session: SessionRecord }
  | { type: "status"; message: string }
  | { type: "delta"; text: string }
  | { type: "artifacts"; artifacts: ResearchArtifacts }
  | { type: "concept-spans"; spans: ConceptSpanForClient[] }
  | { type: "done"; sessionId: string }
  | { type: "error"; message: string };
