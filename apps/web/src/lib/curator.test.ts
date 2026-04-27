import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCurator } from "./curator";

/**
 * Fail-soft invariants. The curator must never throw and must no-op quickly
 * when the graph isn't configured, the app is in mock mode, or the turn
 * produced no concepts. These cases run on every research turn in prod so
 * any regression here would silently burn tokens or break the response.
 */

const originalEnv = { ...process.env };

describe("curator", () => {
  beforeEach(() => {
    delete process.env.NEO4J_URI;
    delete process.env.NEO4J_USER;
    delete process.env.NEO4J_PASSWORD;
    process.env.MOCK_MODEL = "false";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("no-ops when graph env is absent", async () => {
    const result = await runCurator({
      apiKey: "sk-test",
      owner: "principal-1",
      sessionId: "sess-1",
      turnConcepts: [
        { id: "queueing-theory", label: "queueing-theory", currentClaim: "x", currentInsightId: "ins-1" }
      ],
      pool: {} as never,
      hasVector: false
    });
    expect(result).toEqual({ proposed: 0 });
  });

  it("no-ops in mock mode", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";
    process.env.NEO4J_USER = "neo4j";
    process.env.NEO4J_PASSWORD = "polymath-dev";
    process.env.MOCK_MODEL = "true";

    const result = await runCurator({
      apiKey: "sk-mock",
      owner: "principal-1",
      sessionId: "sess-1",
      turnConcepts: [
        { id: "x", label: "x", currentClaim: "c", currentInsightId: "ins-1" }
      ],
      pool: {} as never,
      hasVector: false
    });
    expect(result).toEqual({ proposed: 0 });
  });

  it("no-ops when turnConcepts is empty", async () => {
    process.env.NEO4J_URI = "bolt://localhost:7687";
    process.env.NEO4J_USER = "neo4j";
    process.env.NEO4J_PASSWORD = "polymath-dev";

    const result = await runCurator({
      apiKey: "sk-test",
      owner: "principal-1",
      sessionId: "sess-1",
      turnConcepts: [],
      pool: {} as never,
      hasVector: false
    });
    expect(result).toEqual({ proposed: 0 });
  });
});
