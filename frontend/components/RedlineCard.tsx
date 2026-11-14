"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Edit3,
  Check,
  X,
  BookOpen,
} from "lucide-react";
import type { RedlineProposal, RiskLevel, ClauseDecision } from "@/types/contract";

interface RedlineCardProps {
  redline: RedlineProposal;
  triadScores?: {
    context_relevance: number;
    groundedness: number;
  };
  onDecision: (clauseId: string, decision: ClauseDecision) => void;
  onEdit: (clauseId: string, text: string) => void;
  onHover: (clauseId: string | null) => void;
  currentDecision: ClauseDecision;
  editedText: string | undefined;
}

const RISK_CONFIG: Record<RiskLevel, { label: string; classes: string; dotClass: string }> = {
  HIGH: {
    label: "HIGH RISK",
    classes: "bg-[#fef2f2] text-[#991b1b] border-[#fecaca]",
    dotClass: "bg-[#991b1b]",
  },
  MEDIUM: {
    label: "MEDIUM RISK",
    classes: "bg-[#fffbeb] text-[#92400e] border-[#fde68a]",
    dotClass: "bg-[#d97706]",
  },
  LOW: {
    label: "LOW RISK",
    classes: "bg-[#f0fdf4] text-[#166534] border-[#bbf7d0]",
    dotClass: "bg-[#16a34a]",
  },
};

const CATEGORY_LABEL: Record<string, string> = {
  LIABILITY: "SECTION 1: Limitation of Liability",
  IP_OWNERSHIP: "SECTION 2: IP Ownership & AI Training",
  TERMINATION: "SECTION 3: Term & Auto-Renewal",
  DATA_PRIVACY: "SECTION 4: Data Privacy (GDPR/DPDP)",
  OTHER: "General Provisions",
};

export default function RedlineCard({
  redline,
  triadScores,
  onDecision,
  onEdit,
  onHover,
  currentDecision,
  editedText,
}: RedlineCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [localEdit, setLocalEdit] = useState(editedText ?? redline.proposed_redline);

  const riskCfg = RISK_CONFIG[redline.risk_assessment] ?? RISK_CONFIG.MEDIUM;
  const isApproved = currentDecision === "APPROVED" || currentDecision === "MODIFIED";
  const isRejected = currentDecision === "REJECTED";
  const displayedRedline = editedText ?? redline.proposed_redline;

  function saveEdit() {
    onEdit(redline.clause_id, localEdit);
    setEditing(false);
  }

  function cancelEdit() {
    setLocalEdit(editedText ?? redline.proposed_redline);
    setEditing(false);
  }

  return (
    <div
      className={`rounded border transition-all duration-200 ${
        isApproved
          ? "border-[#bbf7d0] bg-[#f0fdf4]/40"
          : isRejected
          ? "border-[#fecaca] bg-[#fef2f2]/30"
          : "border-[#e5e5e5] bg-white"
      }`}
      onMouseEnter={() => onHover(redline.clause_id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Card header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Clause ID badge */}
        <span className="font-mono text-xs font-bold text-[#0a0a0a] bg-[#f5f5f5] border border-[#e5e5e5] rounded px-1.5 py-0.5 shrink-0">
          {redline.clause_id}
        </span>

        {/* Title */}
        <span className="flex-1 text-sm font-semibold text-[#0a0a0a] truncate">
          {redline.clause_title}
        </span>

        {/* Risk pill */}
        <span
          className={`font-mono text-[9.5px] font-bold px-2 py-0.5 rounded border ${riskCfg.classes} flex items-center gap-1 shrink-0`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${riskCfg.dotClass}`} />
          {riskCfg.label}
        </span>

        {/* Decision badge */}
        {currentDecision !== "PENDING" && (
          <span
            className={`font-mono text-[9px] px-2 py-0.5 rounded font-semibold shrink-0 ${
              isApproved
                ? "bg-[#166534] text-white"
                : "bg-[#991b1b] text-white"
            }`}
          >
            {currentDecision}
          </span>
        )}

        {/* Expand toggle */}
        <button className="text-[#a3a3a3] hover:text-[#0a0a0a] transition-colors shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Playbook citation */}
      <div className="px-4 pb-2 -mt-1">
        <span className="inline-flex items-center gap-1 font-mono text-[9px] text-[#737373] bg-[#fafafa] border border-[#e5e5e5] rounded px-2 py-0.5">
          <BookOpen className="w-2.5 h-2.5" />
          {CATEGORY_LABEL[redline.clause_title?.toUpperCase()] ??
            CATEGORY_LABEL[
              Object.keys(CATEGORY_LABEL).find((k) =>
                redline.clause_title?.toUpperCase().includes(k)
              ) ?? "OTHER"
            ] ??
            "Company Playbook"}
        </span>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Policy violation */}
          {redline.policy_violation && (
            <div className="text-xs text-[#737373] bg-[#fafafa] border border-[#e5e5e5] rounded p-2.5">
              <span className="font-semibold text-[#525252]">Policy Violation: </span>
              {redline.policy_violation}
            </div>
          )}

          {/* Original text (strikethrough / red) */}
          <div>
            <div className="font-mono text-[9.5px] font-semibold text-[#737373] uppercase tracking-wider mb-1.5">
              Original Language
            </div>
            <div className="rounded p-3 bg-[#fef2f2] border border-[#fecaca]">
              <p className="font-mono text-[11.5px] leading-5 text-[#991b1b] line-through decoration-[#991b1b]/60">
                {redline.original_text}
              </p>
            </div>
          </div>

          {/* Proposed redline */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-mono text-[9.5px] font-semibold text-[#737373] uppercase tracking-wider">
                Compliant Redline Proposal
              </div>
              {!editing && !isRejected && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocalEdit(displayedRedline);
                    setEditing(true);
                  }}
                  className="flex items-center gap-1 font-mono text-[9px] text-[#737373] hover:text-[#0a0a0a] transition-colors"
                >
                  <Edit3 className="w-2.5 h-2.5" />
                  Edit Text
                </button>
              )}
            </div>

            {editing ? (
              <div className="space-y-2">
                <textarea
                  className="w-full font-mono text-[11.5px] text-[#166534] leading-5 p-3 rounded bg-[#f0fdf4] border border-[#86efac] outline-none focus:border-[#166534] resize-none min-h-[80px]"
                  value={localEdit}
                  onChange={(e) => setLocalEdit(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={cancelEdit}
                    className="font-mono text-[10px] px-3 py-1 rounded border border-[#e5e5e5] text-[#737373] hover:bg-[#f5f5f5] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEdit}
                    className="font-mono text-[10px] px-3 py-1 rounded bg-[#0a0a0a] text-white hover:bg-[#262626] transition-colors"
                  >
                    Apply Edit
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded p-3 bg-[#f0fdf4] border border-[#86efac]">
                <p className="font-mono text-[11.5px] leading-5 text-[#166534] font-medium">
                  {displayedRedline}
                </p>
                {editedText && editedText !== redline.proposed_redline && (
                  <span className="font-mono text-[8.5px] text-[#16a34a] mt-1 inline-block">
                    ✦ MODIFIED BY REVIEWER
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Justification + RAG Triad badges */}
          {redline.justification && (
            <div className="text-[11px] text-[#525252] leading-5 pt-0.5">
              <span className="font-semibold">Legal Rationale: </span>
              {redline.justification}
            </div>
          )}

          {/* RAG Triad mini-pills */}
          {triadScores && (
            <div className="flex gap-2 flex-wrap">
              <span className="font-mono text-[9px] text-[#525252] bg-[#fafafa] border border-[#e5e5e5] rounded px-2 py-0.5">
                Context Rel:{" "}
                <strong>{Math.round(triadScores.context_relevance * 100)}%</strong>
              </span>
              <span className="font-mono text-[9px] text-[#525252] bg-[#fafafa] border border-[#e5e5e5] rounded px-2 py-0.5">
                Groundedness:{" "}
                <strong>{Math.round(triadScores.groundedness * 100)}%</strong>
              </span>
            </div>
          )}

          {/* HITL action buttons */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() =>
                onDecision(
                  redline.clause_id,
                  isApproved ? "PENDING" : "APPROVED"
                )
              }
              className={`flex items-center gap-1.5 flex-1 justify-center font-mono text-[10.5px] font-semibold py-2 rounded border transition-all ${
                isApproved
                  ? "bg-[#0a0a0a] text-white border-[#0a0a0a]"
                  : "bg-white text-[#0a0a0a] border-[#e5e5e5] hover:border-[#0a0a0a]"
              }`}
            >
              <Check className="w-3 h-3" />
              {isApproved ? "Approved ✓" : "Approve"}
            </button>
            <button
              onClick={() =>
                onDecision(
                  redline.clause_id,
                  isRejected ? "PENDING" : "REJECTED"
                )
              }
              className={`flex items-center gap-1.5 flex-1 justify-center font-mono text-[10.5px] font-semibold py-2 rounded border transition-all ${
                isRejected
                  ? "bg-[#991b1b] text-white border-[#991b1b]"
                  : "bg-white text-[#737373] border-[#e5e5e5] hover:border-[#991b1b] hover:text-[#991b1b]"
              }`}
            >
              <X className="w-3 h-3" />
              {isRejected ? "Rejected ✕" : "Reject"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

