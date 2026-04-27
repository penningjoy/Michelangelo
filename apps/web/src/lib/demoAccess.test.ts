import { describe, expect, it } from "vitest";
import {
  getDefaultLocalPrincipal,
  normalizeDemoPrincipal,
  requireDemoPrincipal
} from "./demoAccess";
import { sourceSchema } from "./schemas";

describe("demoAccess", () => {
  it("defaults to a stable local principal", () => {
    const result = requireDemoPrincipal(new Request("http://localhost/api/sessions"));
    expect(result).toEqual({ ok: true, principal: getDefaultLocalPrincipal() });
  });

  it("allows an explicit principal override via header", () => {
    const result = requireDemoPrincipal(
      new Request("http://localhost/api/sessions", {
        headers: { "x-demo-principal": "reviewer-2" }
      })
    );

    expect(result).toEqual({ ok: true, principal: "reviewer-2" });
    expect(normalizeDemoPrincipal("reviewer-2")).toBe("reviewer-2");
    expect(normalizeDemoPrincipal("bad principal")).toBeNull();
  });
});

describe("sourceSchema", () => {
  it("accepts http and https URLs only", () => {
    expect(
      sourceSchema.safeParse({
        id: "src-1",
        title: "Good source",
        url: "https://example.com/article",
        excerpt: "Example excerpt",
        reason: "Example reason"
      }).success
    ).toBe(true);

    expect(
      sourceSchema.safeParse({
        id: "src-2",
        title: "Bad source",
        url: "javascript:alert(1)",
        excerpt: "Bad excerpt",
        reason: "Bad reason"
      }).success
    ).toBe(false);

    expect(
      sourceSchema.safeParse({
        id: "src-3",
        title: "Bad source",
        url: "data:text/html;base64,PGgxPkhlbGxvPC9oMT4=",
        excerpt: "Bad excerpt",
        reason: "Bad reason"
      }).success
    ).toBe(false);
  });
});
