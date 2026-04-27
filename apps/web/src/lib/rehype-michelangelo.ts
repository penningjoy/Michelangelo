import type { ElementContent, Root, Text } from "hast";
import type { ConceptSpanForClient } from "./types";

type Options = {
  spans: ConceptSpanForClient[];
};

const SKIP_TAGS = new Set(["code", "pre", "a", "script", "style", "math", "svg"]);
const CITATION_REGEX = /\[src-([\w-]+)\]/g;

type Mark =
  | { kind: "citation"; start: number; end: number; srcId: string; raw: string }
  | { kind: "concept"; start: number; end: number; conceptIndex: number };

/**
 * Rehype plugin that decorates the rendered markdown with two custom inline
 * elements:
 *   - <citation-pill data-src-id="src-3"> — rendered as the existing
 *     CitationHoverCard via the react-markdown components map.
 *   - <concept-underline data-concept-index="2"> — rendered as a hover-tipped
 *     span linking to a prior session's claim.
 *
 * Both transforms operate on text nodes only and skip any subtree under
 * <code>, <pre>, <a>, or other content where decoration would corrupt the
 * intended rendering. Concept spans use HAST `position.start.offset` to map
 * raw-markdown offsets onto specific text nodes.
 */
export function rehypeMichelangelo({ spans }: Options) {
  const orderedSpans = [...spans]
    .map((span, originalIndex) => ({ span, originalIndex }))
    .sort((a, b) => a.span.start - b.span.start);

  return (tree: Root) => {
    walk(tree as unknown as { children: ElementContent[] }, []);
  };

  function walk(parent: { children: ElementContent[] }, ancestors: string[]): void {
    const next: ElementContent[] = [];
    for (const child of parent.children) {
      if (child.type === "element") {
        const tag = child.tagName;
        if (SKIP_TAGS.has(tag)) {
          next.push(child);
          continue;
        }
        walk(child, [...ancestors, tag]);
        next.push(child);
        continue;
      }
      if (child.type === "text") {
        const replacements = transformText(child);
        next.push(...replacements);
        continue;
      }
      next.push(child);
    }
    parent.children = next;
  }

  function transformText(node: Text): ElementContent[] {
    const value = node.value;
    if (!value) return [node];

    const sourceStart = node.position?.start?.offset;
    const sourceEnd = node.position?.end?.offset;
    const haveSourceRange =
      typeof sourceStart === "number" &&
      typeof sourceEnd === "number" &&
      sourceEnd - sourceStart === value.length;

    const marks: Mark[] = [];

    let citationMatch: RegExpExecArray | null;
    CITATION_REGEX.lastIndex = 0;
    while ((citationMatch = CITATION_REGEX.exec(value)) !== null) {
      marks.push({
        kind: "citation",
        start: citationMatch.index,
        end: citationMatch.index + citationMatch[0].length,
        srcId: `src-${citationMatch[1]}`,
        raw: citationMatch[0]
      });
    }

    if (haveSourceRange) {
      for (const { span, originalIndex } of orderedSpans) {
        if (span.end <= sourceStart!) continue;
        if (span.start >= sourceEnd!) break;
        const local = {
          start: Math.max(0, span.start - sourceStart!),
          end: Math.min(value.length, span.end - sourceStart!)
        };
        if (local.end <= local.start) continue;
        marks.push({
          kind: "concept",
          start: local.start,
          end: local.end,
          conceptIndex: originalIndex
        });
      }
    }

    if (marks.length === 0) return [node];

    marks.sort((a, b) => a.start - b.start || a.end - b.end);

    const out: ElementContent[] = [];
    let cursor = 0;
    for (const mark of marks) {
      if (mark.start < cursor) continue;
      if (mark.start > cursor) {
        out.push({ type: "text", value: value.slice(cursor, mark.start) });
      }
      const text = value.slice(mark.start, mark.end);
      if (mark.kind === "citation") {
        out.push({
          type: "element",
          tagName: "citation-pill",
          properties: { dataSrcId: mark.srcId },
          children: [{ type: "text", value: text }]
        });
      } else {
        out.push({
          type: "element",
          tagName: "concept-underline",
          properties: { dataConceptIndex: String(mark.conceptIndex) },
          children: [{ type: "text", value: text }]
        });
      }
      cursor = mark.end;
    }
    if (cursor < value.length) {
      out.push({ type: "text", value: value.slice(cursor) });
    }
    return out;
  }
}
