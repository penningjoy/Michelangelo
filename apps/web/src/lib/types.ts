export type Role = "user" | "assistant";

export type SourceArtifact = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  reason: string;
};

export type CoreArtifact = {
  essence: string;
  explanation: string;
};

export type AnalogyArtifact = {
  id: string;
  title: string;
  description: string;
  whyItWorks: string;
};

export type ParallelArtifact = {
  id: string;
  domain: string;
  concept: string;
  connection: string;
  caveat?: string;
};

export type ApplicationArtifact = {
  id: string;
  domain: string;
  use: string;
  example: string;
};

export type UnexploredArtifact = {
  id: string;
  idea: string;
  whyItMatters: string;
  suggestedNextStep?: string;
};

export type FounderOpportunity = {
  id: string;
  productIdea: string;
  targetUser: string;
  painPoint: string;
  oneWeekMvp: string;
  successSignal: string;
  failureMode: string;
  nextExperiment: string;
};

export type FounderModeArtifact = {
  opportunities: FounderOpportunity[];
};

export type PedagogicalClaim = {
  id: string;
  claim: string;
};

export type ResearchArtifacts = {
  summary: {
    title: string;
    framing: string;
  };
  core: CoreArtifact;
  analogies: AnalogyArtifact[];
  parallels: ParallelArtifact[];
  applications: ApplicationArtifact[];
  unexplored: UnexploredArtifact[];
  claims: PedagogicalClaim[];
  concepts: string[];
  sources: SourceArtifact[];
  founderMode?: FounderModeArtifact;
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

export type SessionListItem = SessionRecord & {
  lastTurnGist: string | null;
};

export type ResearchDepth = "quick" | "standard" | "deep";

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
