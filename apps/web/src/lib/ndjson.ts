import type { ResearchEvent } from "./types";

/**
 * Parse one NDJSON line from the research stream. Returns null on empty lines or malformed JSON.
 */
export function parseResearchEventLine(line: string): ResearchEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ResearchEvent;
  } catch {
    if (process.env.NODE_ENV === "development") {
      console.warn("[ndjson] skipped malformed line:", trimmed.slice(0, 200));
    }
    return null;
  }
}
