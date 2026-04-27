"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SourceArtifact } from "../lib/types";

type Props = {
  source: SourceArtifact;
  number: number;
  domain: string;
  onActivate?: () => void;
  children: ReactNode;
};

const OPEN_DELAY_MS = 220;
const CLOSE_DELAY_MS = 140;
const MARGIN = 8;
const CARD_WIDTH = 320;

export function CitationHoverCard({ source, number, domain, onActivate, children }: Props) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const computeCoords = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const left = Math.min(
      Math.max(MARGIN, rect.left + rect.width / 2 - CARD_WIDTH / 2),
      viewportWidth - CARD_WIDTH - MARGIN
    );
    const top = rect.bottom + MARGIN;
    return { top, left };
  }, []);

  const handleOpen = useCallback(() => {
    clearTimers();
    openTimerRef.current = window.setTimeout(() => {
      setCoords(computeCoords());
      setOpen(true);
    }, OPEN_DELAY_MS);
  }, [clearTimers, computeCoords]);

  const handleClose = useCallback(() => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    closeTimerRef.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => setCoords(computeCoords());
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, computeCoords]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return (
    <>
      <span
        ref={anchorRef}
        className="citation-anchor"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpen}
        onBlur={handleClose}
        onClick={() => {
          if (onActivate) onActivate();
        }}
      >
        {children}
      </span>
      {mounted && open && coords
        ? createPortal(
            <div
              ref={cardRef}
              className="citation-hovercard"
              role="tooltip"
              style={{ top: coords.top, left: coords.left, width: CARD_WIDTH }}
              onMouseEnter={() => clearTimers()}
              onMouseLeave={handleClose}
            >
              <div className="citation-hovercard-head">
                <span className="citation-hovercard-num">{number}</span>
                <div>
                  <p className="citation-hovercard-domain">{domain}</p>
                  <p className="citation-hovercard-title">{source.title}</p>
                </div>
              </div>
              {source.excerpt ? (
                <p className="citation-hovercard-excerpt">"{source.excerpt}"</p>
              ) : null}
              <p className="citation-hovercard-reason">{source.reason}</p>
              <a
                className="citation-hovercard-link"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                Open source ↗
              </a>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
