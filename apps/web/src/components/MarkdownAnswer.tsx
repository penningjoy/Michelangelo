"use client";

import "katex/dist/katex.min.css";
import { useDeferredValue, useMemo } from "react";
import type { ComponentProps, ReactNode } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { CitationHoverCard } from "./CitationHoverCard";
import { CodeBlock } from "./CodeBlock";
import { rehypeMichelangelo } from "../lib/rehype-michelangelo";
import type { ConceptSpanForClient, SourceArtifact } from "../lib/types";

type MarkdownAnswerProps = {
  text: string;
  spans: ConceptSpanForClient[];
  sources: SourceArtifact[];
  sourceOrder: Map<string, number>;
  onCitationClick?: (srcId: string) => void;
};

type MdComponents = NonNullable<ComponentProps<typeof Markdown>["components"]>;
type MdRehypePlugins = ComponentProps<typeof Markdown>["rehypePlugins"];

export function MarkdownAnswer({
  text,
  spans,
  sources,
  sourceOrder,
  onCitationClick
}: MarkdownAnswerProps) {
  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources]
  );

  const deferredText = useDeferredValue(text);

  const remarkPlugins = useMemo(() => [remarkGfm, remarkBreaks, remarkMath], []);
  const rehypePlugins = useMemo<MdRehypePlugins>(
    () => [
      rehypeKatex,
      [rehypeSanitize, sanitizeSchema],
      [rehypeMichelangelo, { spans }]
    ] as MdRehypePlugins,
    [spans]
  );

  const components = useMemo<MdComponents>(() => {
    const CitationPill = ({
      "data-src-id": srcId,
      children
    }: {
      "data-src-id"?: string;
      children?: ReactNode;
    }) => {
      if (!srcId) return <>{children}</>;
      const source = sourceById.get(srcId);
      const num = sourceOrder.get(srcId);
      if (!source || !num) {
        return (
          <sup className="citation citation--unknown" title={srcId}>
            ?
          </sup>
        );
      }
      return (
        <CitationHoverCard
          source={source}
          number={num}
          domain={domainFromUrl(source.url)}
          onActivate={() => onCitationClick?.(source.id)}
        >
          <sup className="citation">
            <span className="citation-pill">{num}</span>
          </sup>
        </CitationHoverCard>
      );
    };

    const ConceptUnderline = ({
      "data-concept-index": indexAttr,
      children
    }: {
      "data-concept-index"?: string;
      children?: ReactNode;
    }) => {
      const idx = Number(indexAttr);
      const span = Number.isFinite(idx) ? spans[idx] : undefined;
      if (!span) return <span>{children}</span>;
      const tooltip = span.priorSessionTitle
        ? `From "${span.priorSessionTitle}" (turn ${span.priorTurnIndex}): ${span.priorClaim ?? ""}`
        : span.conceptLabel;
      return (
        <span className="concept-underline" title={tooltip}>
          {children}
        </span>
      );
    };

    return {
      code: CodeBlock as unknown as MdComponents["code"],
      pre: ({ children }) => <>{children}</>,
      a: ({ href, children, ...rest }) => (
        <a
          {...rest}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="md-link"
        >
          {children}
        </a>
      ),
      table: ({ children }) => (
        <div className="md-table-scroll">
          <table className="md-table">{children}</table>
        </div>
      ),
      "citation-pill": CitationPill as unknown as MdComponents["span"],
      "concept-underline": ConceptUnderline as unknown as MdComponents["span"]
    };
  }, [sourceById, sourceOrder, spans, onCitationClick]);

  return (
    <div className="assistant-prose markdown-answer">
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {deferredText}
      </Markdown>
    </div>
  );
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const sanitizeSchema = (() => {
  const base = structuredClone(defaultSchema);
  const allowedTags = new Set(base.tagNames ?? []);
  for (const tag of [
    "citation-pill",
    "concept-underline",
    "math",
    "semantics",
    "annotation",
    "mrow",
    "mi",
    "mn",
    "mo",
    "ms",
    "mtext",
    "mfrac",
    "msup",
    "msub",
    "msubsup",
    "munder",
    "mover",
    "munderover",
    "msqrt",
    "mroot",
    "mtable",
    "mtr",
    "mtd",
    "mspace",
    "mpadded"
  ]) {
    allowedTags.add(tag);
  }
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

  base.protocols = {
    ...base.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"]
  };

  return base;
})();
