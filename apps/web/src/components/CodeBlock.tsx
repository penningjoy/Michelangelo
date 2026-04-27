"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

type ShikiHighlighter = {
  codeToHtml: (code: string, options: { lang: string; themes: { light: string; dark: string } }) => string;
};

let highlighterPromise: Promise<ShikiHighlighter> | null = null;
const SUPPORTED_LANGS = [
  "ts", "tsx", "js", "jsx", "json", "bash", "shell", "sh", "zsh",
  "python", "py", "go", "rust", "java", "c", "cpp", "csharp", "ruby",
  "php", "html", "css", "scss", "sql", "yaml", "yml", "toml", "md",
  "markdown", "diff", "dockerfile", "graphql", "swift", "kotlin"
];

function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(async ({ createHighlighter }) => {
      const hl = await createHighlighter({
        themes: ["github-light", "github-dark"],
        langs: SUPPORTED_LANGS
      });
      return hl as unknown as ShikiHighlighter;
    });
  }
  return highlighterPromise;
}

function normalizeLang(raw: string | undefined): string {
  if (!raw) return "text";
  const lower = raw.toLowerCase();
  if (lower === "shell" || lower === "sh" || lower === "zsh") return "bash";
  if (lower === "py") return "python";
  if (lower === "yml") return "yaml";
  if (lower === "md") return "markdown";
  if (lower === "ts") return "ts";
  return SUPPORTED_LANGS.includes(lower) ? lower : "text";
}

type CodeBlockProps = {
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
};

export function CodeBlock({ className, children, ...rest }: CodeBlockProps) {
  const language = (className?.match(/language-([\w-]+)/)?.[1] ?? "").trim();
  const isInline = !className || !language;
  const code = extractText(children);

  if (isInline) {
    return <code className="md-inline-code">{children}</code>;
  }

  if (language === "mermaid") {
    return <MermaidBlock code={code} />;
  }

  return <ShikiBlock code={code} language={language} fallbackClass={className} {...rest} />;
}

function ShikiBlock({
  code,
  language,
  fallbackClass
}: {
  code: string;
  language: string;
  fallbackClass?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const lang = normalizeLang(language);

  useEffect(() => {
    let cancelled = false;
    getHighlighter()
      .then((hl) => {
        if (cancelled) return;
        try {
          const out = hl.codeToHtml(code, {
            lang,
            themes: { light: "github-light", dark: "github-dark" }
          });
          setHtml(out);
        } catch {
          setHtml(null);
        }
      })
      .catch(() => setHtml(null));
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const onCopy = () => {
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      },
      () => undefined
    );
  };

  return (
    <figure className="md-codeblock">
      <header className="md-codeblock-head">
        <span className="md-codeblock-lang">{lang === "text" ? "code" : lang}</span>
        <button type="button" className="md-codeblock-copy" onClick={onCopy} aria-label="Copy code">
          {copied ? "Copied" : "Copy"}
        </button>
      </header>
      {html ? (
        <div className="md-codeblock-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className={fallbackClass}>
          <code>{code}</code>
        </pre>
      )}
    </figure>
  );
}

function MermaidBlock({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg(null);
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          fontFamily: "inherit"
        });
        try {
          const { svg: rendered } = await mermaid.render(`mmd-${id}`, code);
          if (!cancelled) setSvg(rendered);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Could not render diagram");
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load mermaid");
      });
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  return (
    <figure className="md-mermaid">
      <header className="md-mermaid-head">
        <span className="md-mermaid-label">diagram</span>
        <button
          type="button"
          className="md-codeblock-copy"
          onClick={() => setShowSource((value) => !value)}
        >
          {showSource ? "Hide source" : "View source"}
        </button>
      </header>
      {error ? (
        <pre className="md-mermaid-error">{error}</pre>
      ) : svg ? (
        <div ref={containerRef} className="md-mermaid-body" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="md-mermaid-loading muted">rendering diagram…</div>
      )}
      {showSource ? <pre className="md-mermaid-source">{code}</pre> : null}
    </figure>
  );
}

function extractText(node: ReactNode): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && node !== null && "props" in (node as object)) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return extractText(props?.children);
  }
  return "";
}
