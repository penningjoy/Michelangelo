import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResearchArtifacts } from "./types";
import {
  checkDatabase,
  createSession,
  listArtifacts,
  listConceptsForOwner,
  listMessages,
  listOwnedConceptIds,
  listSessionConceptIds,
  listSessions,
  listTurnSummaries,
  persistTurn,
  renameSession,
  replaceArtifacts,
  resetStorageForTests
} from "./storage";

const originalEnv = { ...process.env };

describe("storage ownership", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    resetStorageForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetStorageForTests();
  });

  it("scopes session listing and rename by owner", async () => {
    const alpha = await createSession("Alpha session", "principal-alpha");
    const beta = await createSession("Beta session", "principal-beta");

    const alphaSessions = await listSessions("principal-alpha");
    const betaSessions = await listSessions("principal-beta");

    expect(alphaSessions.map((session) => session.id)).toEqual([alpha.id]);
    expect(betaSessions.map((session) => session.id)).toEqual([beta.id]);

    expect(await renameSession(alpha.id, "Renamed", "principal-beta")).toBeNull();
    expect(await renameSession(alpha.id, "Renamed", "principal-alpha")).toMatchObject({
      id: alpha.id,
      title: "Renamed"
    });
  });

  it("returns empty session data for a foreign owner", async () => {
    const owned = await createSession("Owned", "principal-alpha");

    expect(await listMessages(owned.id, "principal-beta")).toEqual([]);
    expect(await listArtifacts(owned.id, "principal-beta")).toEqual([]);
    expect(await listTurnSummaries(owned.id, "principal-beta")).toEqual([]);
    expect(await listSessionConceptIds(owned.id, "principal-beta")).toEqual([]);
    expect(await listConceptsForOwner("principal-beta")).toEqual([]);
    expect(await listOwnedConceptIds("principal-beta")).toEqual(new Set());
  });

  it("reports memory mode when Postgres is not configured", async () => {
    await expect(checkDatabase()).resolves.toEqual({
      ok: true,
      mode: "memory",
      reason:
        "Postgres is not configured. Using in-memory storage until DATABASE_URL or POSTGRES_URL is set."
    });
  });

  it("skips optional undefined artifacts when persisting", async () => {
    const session = await createSession("Artifacts", "principal-alpha");
    const artifacts: ResearchArtifacts = {
      summary: {
        title: "Title",
        framing: "Framing"
      },
      core: {
        essence: "Essence",
        explanation: "Explanation"
      },
      analogies: [],
      parallels: [],
      applications: [],
      unexplored: [],
      claims: [],
      concepts: ["concept-a"],
      sources: [
        {
          id: "src-1",
          title: "Source",
          url: "https://example.com",
          excerpt: "Excerpt",
          reason: "Reason"
        }
      ],
      founderMode: undefined
    };

    const replaced = await replaceArtifacts(session.id, artifacts);
    expect(replaced.map((row) => row.type)).not.toContain("founderMode");

    await persistTurn(session.id, {
      turnIndex: 0,
      artifacts,
      compact: {
        gist: "gist",
        keyClaims: []
      },
      conceptsByInsight: {}
    });

    const stored = await listArtifacts(session.id, "principal-alpha");
    expect(stored.map((row) => row.type)).not.toContain("founderMode");
  });
});
