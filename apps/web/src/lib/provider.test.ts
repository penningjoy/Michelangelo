import { describe, expect, it } from "vitest";
import { parseJsonObject } from "./provider";

describe("parseJsonObject", () => {
  it("parses a strict JSON object", () => {
    expect(parseJsonObject('{"answer":"ok"}')).toEqual({ answer: "ok" });
  });

  it("extracts a JSON object from surrounding text", () => {
    expect(parseJsonObject('prefix {"answer":"ok"} suffix')).toEqual({ answer: "ok" });
  });
});
