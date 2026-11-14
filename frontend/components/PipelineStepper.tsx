"use client";

import React from "react";
import {
  CheckCircle,
  Circle,
  Loader,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import type { PipelineStageState } from "@/types/contract";

const STAGES: { id: PipelineStageState["id"]; label: string; shortLabel: string }[] = [
  { id: "extract_clauses", label: "Extract Clauses", shortLabel: "Extract" },
  { id: "retrieve_policies", label: "Auto-Merge Playbook", shortLabel: "RAG" },
  { id: "draft_redlines", label: "Draft Redlines", shortLabel: "Draft" },
  { id: "critique_redlines", label: "Compliance Critique", shortLabel: "Critique" },
  { id: "evaluate_rag_triad", label: "RAG Triad Audit", shortLabel: "Triad" },
  { id: "human_review", label: "Human Review (HITL)", shortLabel: "HITL" },
];

interface PipelineStepperProps {
  stages: PipelineStageState[];
}

function StageIcon({ status }: { status: PipelineStageState["status"] }) {
  const cls = "w-4 h-4 shrink-0";
  switch (status) {
    case "completed":
      return <CheckCircle className={`${cls} text-[#0a0a0a]`} />;
    case "running":
      return (
        <Loader
          className={`${cls} text-[#0a0a0a] animate-spin`}
          aria-label="Running"
        />
      );
    case "error":
      return <AlertCircle className={`${cls} text-[#991b1b]`} />;
    default:
      return <Circle className={`${cls} text-[#d4d4d4]`} />;
  }
}

export default function PipelineStepper({ stages }: PipelineStepperProps) {
  // Build a map keyed by stage id for quick lookup
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  return (
    <div className="flex items-center gap-0 w-full overflow-x-auto pb-1">
      {STAGES.map((stageDef, idx) => {
        const stage = stageMap.get(stageDef.id);
        const status = stage?.status ?? "pending";
        const revisionCount = stage?.revisionCount ?? 0;
        const isLast = idx === STAGES.length - 1;

        return (
          <React.Fragment key={stageDef.id}>
            <div className="flex flex-col items-center gap-1 min-w-[88px]">
              {/* Icon + revision badge */}
              <div className="relative flex items-center justify-center">
                <StageIcon status={status} />
                {stageDef.id === "draft_redlines" && revisionCount > 1 && (
                  <span className="absolute -top-2 -right-3 font-mono text-[9px] font-semibold bg-[#0a0a0a] text-white px-1 rounded leading-tight">
                    Rev {revisionCount}
                  </span>
                )}
                {stageDef.id === "critique_redlines" && revisionCount > 1 && (
                  <span
                    className="absolute -top-2 -right-3"
                    title="Self-critique loop active"
                  >
                    <RefreshCw className="w-2.5 h-2.5 text-[#737373]" />
                  </span>
                )}
              </div>
              {/* Label */}
              <span
                className={`font-mono text-[9.5px] text-center leading-tight whitespace-nowrap ${
                  status === "completed"
                    ? "text-[#0a0a0a] font-semibold"
                    : status === "running"
                    ? "text-[#0a0a0a]"
                    : "text-[#a3a3a3]"
                }`}
              >
                {stageDef.shortLabel}
              </span>
            </div>

            {/* Connector */}
            {!isLast && (
              <div
                className={`flex-1 h-px mx-1 ${
                  status === "completed" ? "bg-[#0a0a0a]" : "bg-[#e5e5e5]"
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

