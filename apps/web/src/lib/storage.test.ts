import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  listArtifacts,
  listConceptsForOwner,
  listMessages,
  listOwnedConceptIds,
  listSessionConceptIds,
  listSessions,
  listTurnSummaries,
  renameSession,
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
});
