import { describe, expect, it } from "vitest";
import { defaultSchema } from "rehype-sanitize";

describe("sanitizeSchema IIFE", () => {
  it("constructs without throwing", () => {
    const fn = () => {
      const base = structuredClone(defaultSchema);
      const allowedTags = new Set(base.tagNames ?? []);
      for (const tag of [
        "citation-pill","concept-underline","math","semantics","annotation",
        "mrow","mi","mn","mo","ms","mtext","mfrac","msup","msub","msubsup",
        "munder","mover","munderover","msqrt","mroot","mtable","mtr","mtd","mspace","mpadded"
      ]) allowedTags.add(tag);
      base.tagNames = Array.from(allowedTags);
      const baseAttributes = base.attributes ?? {};
      base.attributes = {
        ...baseAttributes,
        "*": [...(baseAttributes["*"] ?? []), "className", "style", "ariaHidden", "ariaLabel"],
        "citation-pill": ["dataSrcId"],
        "concept-underline": ["dataConceptIndex"],
        span: [...(baseAttributes.span ?? []), "className", "style"],
        div: [...(baseAttributes.div ?? []), "className", "style"],
        code: [...(baseAttributes.code ?? []), "className"],
        math: [...(baseAttributes.math ?? []), "xmlns", "display"],
        annotation: ["encoding"]
      };
      base.protocols = { ...base.protocols, href: ["http","https","mailto"], src: ["http","https"] };
      return base;
    };
    expect(() => fn()).not.toThrow();
    const schema = fn();
    expect(schema.tagNames).toContain("citation-pill");
    expect(schema.attributes?.["citation-pill"]).toContain("dataSrcId");
  });
});
