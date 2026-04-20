import { describe, expect, it } from "vitest";
import { buildRecallDrill } from "./learning";
import type { ResearchArtifacts } from "./types";

const artifacts: ResearchArtifacts = {
  summary: { title: "t", framing: "f" },
  sources: [
    { id: "src-1", title: "S1", url: "https://example.com", excerpt: "e", reason: "r" }
  ],
  insights: [
    {
      id: "ins-1",
      claim: "Queueing delay grows nonlinearly as utilization approaches saturation.",
      evidenceLevel: "strong",
      sourceIds: ["src-1"],
      caveat: "Assumes stable arrival/service distributions.",
      concepts: ["queueing-theory", "capacity-planning"],
      staked: true
    },
    {
      id: "ins-2",
      claim: "Batching can increase throughput but hurt latency tails.",
      evidenceLevel: "tentative",
      sourceIds: ["src-1"],
      caveat: "Workload dependent.",
      concepts: ["batching"],
      staked: false
    }
  ],
  caveats: [{ id: "cav-1", text: "Real traffic is bursty.", severity: "medium" }]
};

describe("buildRecallDrill", () => {
  it("builds a mixed recall + transfer drill", () => {
    const drill = buildRecallDrill(artifacts);
    expect(drill.length).toBeGreaterThanOrEqual(4);
    expect(drill.some((item) => item.kind === "transfer")).toBe(true);
    expect(drill[0]?.sampleAnswer).toContain("Queueing delay grows nonlinearly");
  });

  it("falls back safely when concepts are sparse", () => {
    const drill = buildRecallDrill({
      ...artifacts,
      insights: [{ ...artifacts.insights[0], concepts: [] }]
    });
    const transfer = drill.find((item) => item.kind === "transfer");
    expect(transfer?.question).toContain("Core concept");
  });
});
