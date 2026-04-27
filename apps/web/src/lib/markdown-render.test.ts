import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { rehypeMichelangelo } from "./rehype-michelangelo";

const sanitizeSchema = (() => {
  const base = structuredClone(defaultSchema);
  const allowedTags = new Set(base.tagNames ?? []);
  for (const tag of ["citation-pill", "concept-underline"]) allowedTags.add(tag);
  base.tagNames = Array.from(allowedTags);
  const baseAttrs = base.attributes ?? {};
  base.attributes = {
    ...baseAttrs,
    "*": [...(baseAttrs["*"] ?? []), "className", "style"],
    "citation-pill": ["dataSrcId"],
    "concept-underline": ["dataConceptIndex"]
  };
  return base;
})();

async function render(markdown: string, spans: Parameters<typeof rehypeMichelangelo>[0]["spans"] = []): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkBreaks)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeMichelangelo, { spans })
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

describe("markdown render pipeline", () => {
  it("renders plain prose", async () => {
    const out = await render("Hello world.");
    expect(out).toContain("Hello world.");
    expect(out).toMatch(/<p>/);
  });

  it("renders citations as <citation-pill>", async () => {
    const out = await render("This is a fact [src-1].");
    expect(out).toContain("<citation-pill");
    expect(out).toContain('data-src-id="src-1"');
  });

  it("renders fenced code blocks", async () => {
    const out = await render("```ts\nconst x = 1;\n```");
    expect(out).toMatch(/<pre>/);
    expect(out).toContain("const x = 1;");
  });

  it("renders the existing mock answer", async () => {
    const mockAnswer = `A concept becomes durable when it stops feeling like a definition and starts behaving like a tool 🧰 [src-1][src-2].\n\nYou can picture the learning arc like this:\nidea -> mechanism -> example -> transfer\n         |                    \\\n         +--> memory ---------> reuse [src-3]\n\nMichelangelo should therefore teach by translation.`;
    const out = await render(mockAnswer);
    expect(out.length).toBeGreaterThan(100);
    expect(out).toContain("durable");
    expect(out).toContain("citation-pill");
  });

  it("renders math via katex", async () => {
    const out = await render("Inline $a^2 + b^2 = c^2$ math.");
    expect(out).toMatch(/katex/);
  });
});
