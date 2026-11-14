"use client";

import React, { useRef, useEffect } from "react";
import type { ExtractedClause } from "@/types/contract";

interface ContractViewerProps {
  rawText: string;
  clauses: ExtractedClause[];
  activeClauseId: string | null;
}

export default function ContractViewer({
  rawText,
  clauses,
  activeClauseId,
}: ContractViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clauseRefs = useRef<Record<string, HTMLElement | null>>({});

  // Scroll to highlighted clause when activeClauseId changes
  useEffect(() => {
    if (!activeClauseId) return;
    const el = clauseRefs.current[activeClauseId];
    if (el && containerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeClauseId]);

  // Build a lookup of original texts -> clause_id
  const clauseMap = new Map<string, string>(
    clauses.map((c) => [c.original_text.trim(), c.clause_id])
  );

  /**
   * Render the raw contract text, highlighting matching clause excerpts.
   * We split the text around each clause's original_text and annotate.
   */
  function renderAnnotatedText(): React.ReactNode[] {
    if (clauses.length === 0) {
      return rawText.split("\n").map((line, i) => (
        <span key={i} className="block leading-relaxed">
          {line || <br />}
        </span>
      ));
    }

    // Build a list of [start, end, clauseId] ranges in the text
    type Range = { start: number; end: number; clauseId: string };
    const ranges: Range[] = [];

    for (const [excerpt, clauseId] of clauseMap) {
      let searchFrom = 0;
      while (searchFrom < rawText.length) {
        const idx = rawText.indexOf(excerpt, searchFrom);
        if (idx === -1) break;
        // Avoid duplicate overlapping ranges
        const overlaps = ranges.some(
          (r) => idx < r.end && idx + excerpt.length > r.start
        );
        if (!overlaps) {
          ranges.push({ start: idx, end: idx + excerpt.length, clauseId });
        }
        searchFrom = idx + excerpt.length;
      }
    }

    ranges.sort((a, b) => a.start - b.start);

    const nodes: React.ReactNode[] = [];
    let cursor = 0;

    for (const { start, end, clauseId } of ranges) {
      // Plain text before this range
      if (cursor < start) {
        const plain = rawText.slice(cursor, start);
        nodes.push(
          <span key={`plain-${cursor}`} className="whitespace-pre-wrap leading-relaxed text-[#0a0a0a]">
            {plain}
          </span>
        );
      }

      // Annotated clause span
      const isActive = clauseId === activeClauseId;
      nodes.push(
        <span
          key={`clause-${clauseId}-${start}`}
          ref={(el) => {
            clauseRefs.current[clauseId] = el;
          }}
          className={`clause-highlight relative cursor-pointer rounded-sm px-0.5 transition-colors duration-300 leading-relaxed whitespace-pre-wrap ${
            isActive
              ? "bg-amber-100 text-[#0a0a0a] outline outline-1 outline-amber-300"
              : "bg-[#fef9c3]/40 text-[#0a0a0a] hover:bg-amber-100/70"
          }`}
          title={`Clause ${clauseId}`}
        >
          {rawText.slice(start, end)}
          <span className="font-mono text-[9px] text-[#737373] ml-1 select-none align-super">
            {clauseId}
          </span>
        </span>
      );

      cursor = end;
    }

    // Remaining plain text
    if (cursor < rawText.length) {
      nodes.push(
        <span key="tail" className="whitespace-pre-wrap leading-relaxed text-[#0a0a0a]">
          {rawText.slice(cursor)}
        </span>
      );
    }

    return nodes;
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto px-6 py-6">
      {/* Document header */}
      <div className="mb-6 pb-4 border-b border-[#e5e5e5]">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a]" />
          <span className="font-mono text-[10px] text-[#737373] uppercase tracking-widest">
            Source Contract
          </span>
        </div>
        {clauses.length > 0 && (
          <p className="text-xs text-[#737373] mt-1">
            {clauses.length} clause{clauses.length !== 1 ? "s" : ""} identified —
            highlighted segments map to redline cards →
          </p>
        )}
      </div>

      {/* Contract body */}
      <div className="font-mono text-[13px] leading-7 text-[#0a0a0a] pb-16">
        {renderAnnotatedText()}
      </div>

      {!rawText && (
        <div className="flex items-center justify-center h-32 text-[#a3a3a3] text-sm">
          No contract text loaded.
        </div>
      )}
    </div>
  );
}

