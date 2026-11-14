"use client";

import React, { useState, useEffect, useRef, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  CheckCheck,
  RotateCcw,
  AlertCircle,
  FileCheck2,
  Terminal,
  Loader2,
  Copy,
  Check,
} from "lucide-react";

import PipelineStepper from "@/components/PipelineStepper";
import ContractViewer from "@/components/ContractViewer";
import RedlineCard from "@/components/RedlineCard";

import {
  getThreadState,
  getStreamUrl,
  resumeThread,
  getExportUrl,
} from "@/lib/api";

import type {
  ThreadState,
  RedlineProposal,
  ExtractedClause,
  TriadEvaluation,
  PipelineStageState,
  PipelineStage,
  ClauseDecision,
} from "@/types/contract";

const INITIAL_STAGES: PipelineStageState[] = [
  { id: "extract_clauses", label: "Extract Clauses", status: "pending" },
  { id: "retrieve_policies", label: "Auto-Merge Playbook", status: "pending" },
  { id: "draft_redlines", label: "Draft Redlines", status: "pending", revisionCount: 0 },
  { id: "critique_redlines", label: "Compliance Critique", status: "pending" },
  { id: "evaluate_rag_triad", label: "RAG Triad Audit", status: "pending" },
  { id: "human_review", label: "Human Review (HITL)", status: "pending" },
];

interface ExecutionLog {
  timestamp: string;
  node: string;
  message: string;
  revisionCount?: number;
}

export const dynamic = "force-dynamic";

export default function ReviewWorkspacePage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const resolvedParams = use(params);
  const threadId = resolvedParams.threadId;

  // Thread data
  const [threadState, setThreadState] = useState<ThreadState | null>(null);
  const [contractTitle, setContractTitle] = useState("Contract Review");
  const [rawText, setRawText] = useState("");
  const [clauses, setClauses] = useState<ExtractedClause[]>([]);
  const [redlines, setRedlines] = useState<RedlineProposal[]>([]);
  const [triadEval, setTriadEval] = useState<TriadEvaluation | null>(null);

  // Stepper & Orchestration
  const [stages, setStages] = useState<PipelineStageState[]>(INITIAL_STAGES);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAwaitingReview, setIsAwaitingReview] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Interactive Review state
  const [decisions, setDecisions] = useState<Record<string, ClauseDecision>>({});
  const [editedRedlines, setEditedRedlines] = useState<Record<string, string>>({});
  const [activeClauseId, setActiveClauseId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll execution logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Initial load: Fetch durable state from database first
  useEffect(() => {
    let active = true;

    async function loadInitialState() {
      try {
        const state = await getThreadState(threadId);
        if (!active) return;

        setThreadState(state);
        if (state.contract_title) setContractTitle(state.contract_title);
        if (state.raw_contract_text) setRawText(state.raw_contract_text);
        if (state.clauses && state.clauses.length > 0) setClauses(state.clauses);
        if (state.triad_evaluation) setTriadEval(state.triad_evaluation);

        // If thread already has redlines in checkpoint
        if (state.redlines && state.redlines.length > 0) {
          setRedlines(state.redlines);
          // Initialize decision map
          const initDecisions: Record<string, ClauseDecision> = {};
          state.redlines.forEach((r) => {
            initDecisions[r.clause_id] = r.decision || "PENDING";
          });
          setDecisions(initDecisions);

          // Mark stages as completed
          setStages([
            { id: "extract_clauses", label: "Extract Clauses", status: "completed" },
            { id: "retrieve_policies", label: "Auto-Merge Playbook", status: "completed" },
            { id: "draft_redlines", label: "Draft Redlines", status: "completed", revisionCount: state.revision_count || 1 },
            { id: "critique_redlines", label: "Compliance Critique", status: "completed" },
            { id: "evaluate_rag_triad", label: "RAG Triad Audit", status: "completed" },
            { id: "human_review", label: "Human Review (HITL)", status: state.status === "completed" ? "completed" : "running" },
          ]);

          if (state.status === "completed") {
            setIsCompleted(true);
            setIsAwaitingReview(false);
          } else {
            setIsAwaitingReview(true);
          }
          return;
        }

        // If not already in review state, connect to SSE stream
        startSseStream();
      } catch (err: any) {
        console.warn("Could not load initial thread state, falling back to SSE stream:", err);
        startSseStream();
      }
    }

    loadInitialState();

    return () => {
      active = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [threadId]);

  // Connect to SSE stream
  function startSseStream() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setStreamError(null);
    setIsStreaming(true);

    const streamUrl = getStreamUrl(threadId);
    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    addLog("system", `Connecting to LangGraph execution stream for thread ${threadId.slice(0, 8)}...`);

    // Handle node_update events
    es.addEventListener("node_update", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const nodeName: PipelineStage = data.node;
        const revisionCount = data.revision_count || 0;
        const critiqueFeedback = data.critique_feedback || "";

        addLog(
          nodeName,
          `Node completed: ${nodeName}${revisionCount > 1 ? ` (Revision #${revisionCount})` : ""}${critiqueFeedback ? ` — Feedback: ${critiqueFeedback.slice(0, 80)}...` : ""}`,
          revisionCount
        );

        setStages((prev) =>
          prev.map((s) => {
            if (s.id === nodeName) {
              return {
                ...s,
                status: "completed",
                revisionCount: revisionCount || s.revisionCount,
                critiqueFeedback,
              };
            }
            return s;
          })
        );

        // If critique looped back to draft
        if (nodeName === "critique_redlines" && critiqueFeedback && revisionCount > 1) {
          setStages((prev) =>
            prev.map((s) => (s.id === "draft_redlines" ? { ...s, status: "running", revisionCount } : s))
          );
        }
      } catch (err) {
        console.error("Failed to parse node_update:", err);
      }
    });

    // Handle interrupt event (human review pause)
    es.addEventListener("interrupt", async (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        addLog("human_review", "Execution halted at HITL interrupt. Awaiting human decisions.");

        if (data.redlines) {
          setRedlines(data.redlines);
          const initDecisions: Record<string, ClauseDecision> = {};
          data.redlines.forEach((r: RedlineProposal) => {
            initDecisions[r.clause_id] = r.decision || "PENDING";
          });
          setDecisions(initDecisions);
        }

        if (data.triad_summary) {
          setTriadEval((prev) => ({
            context_relevance_score: data.triad_summary.context_relevance,
            context_relevance_reason: "",
            groundedness_score: data.triad_summary.groundedness,
            groundedness_reason: "",
            answer_relevance_score: data.triad_summary.answer_relevance,
            answer_relevance_reason: "",
            triad_summary: data.triad_summary,
          }));
        }

        // Fetch refreshed state from database snapshot to get all extracted clauses
        try {
          const fresh = await getThreadState(threadId);
          if (fresh.clauses) setClauses(fresh.clauses);
          if (fresh.raw_contract_text) setRawText(fresh.raw_contract_text);
        } catch {
          /* ignore */
        }

        setStages((prev) =>
          prev.map((s) => {
            if (s.id === "human_review") return { ...s, status: "running" };
            return { ...s, status: "completed" };
          })
        );

        setIsAwaitingReview(true);
        setIsStreaming(false);
        es.close();
      } catch (err) {
        console.error("Failed to parse interrupt:", err);
      }
    });

    // Handle error event
    es.addEventListener("error", (e: any) => {
      console.warn("SSE error received:", e);
      addLog("error", "Stream closed or interrupted.");
      setIsStreaming(false);
      es.close();
    });

    es.onerror = () => {
      setIsStreaming(false);
      es.close();
    };
  }

  function addLog(node: string, message: string, revisionCount?: number) {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs((prev) => [
      ...prev,
      { timestamp: time, node, message, revisionCount },
    ]);
  }

  // Handle per-clause decision
  function handleDecision(clauseId: string, decision: ClauseDecision) {
    setDecisions((prev) => ({ ...prev, [clauseId]: decision }));
  }

  // Handle per-clause text modification
  function handleEdit(clauseId: string, text: string) {
    setEditedRedlines((prev) => ({ ...prev, [clauseId]: text }));
    setDecisions((prev) => ({ ...prev, [clauseId]: "MODIFIED" }));
  }

  // Bulk Approve All
  function handleApproveAll() {
    const updated: Record<string, ClauseDecision> = {};
    redlines.forEach((r) => {
      updated[r.clause_id] = "APPROVED";
    });
    setDecisions(updated);
  }

  // Finalize & Export DOCX
  async function handleFinalizeAndExport() {
    try {
      setIsFinalizing(true);
      setStreamError(null);

      // Default any remaining PENDING to APPROVED
      const finalDecisions: Record<string, ClauseDecision> = { ...decisions };
      redlines.forEach((r) => {
        if (!finalDecisions[r.clause_id] || finalDecisions[r.clause_id] === "PENDING") {
          finalDecisions[r.clause_id] = "APPROVED";
        }
      });

      const response = await resumeThread(threadId, {
        decisions: finalDecisions,
        edited_redlines: editedRedlines,
      });

      setIsCompleted(true);
      setIsAwaitingReview(false);
      setStages((prev) => prev.map((s) => ({ ...s, status: "completed" })));

      // Trigger file download
      const exportUrl = getExportUrl(threadId);
      window.location.href = exportUrl;
    } catch (err: any) {
      setStreamError(err.message || "Failed to finalize and export redlined contract.");
    } finally {
      setIsFinalizing(false);
    }
  }

  // Count reviewed
  const reviewedCount = Object.values(decisions).filter(
    (d) => d === "APPROVED" || d === "REJECTED" || d === "MODIFIED"
  ).length;
  const totalCount = redlines.length;

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-white text-[#0a0a0a] font-sans selection:bg-[#0a0a0a] selection:text-white">
      {/* ----------------- TOP TOOLBAR ----------------- */}
      <header className="border-b border-[#e5e5e5] bg-white shrink-0 z-20">
        <div className="px-6 py-2.5 flex items-center justify-between gap-4">
          {/* Back & Contract Title */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="p-1.5 rounded border border-[#e5e5e5] hover:border-[#0a0a0a] transition-colors text-[#525252] hover:text-[#0a0a0a] shrink-0"
              title="Return to Ingestion"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-[#0a0a0a] truncate">
                {contractTitle}
              </h1>
              <div className="flex items-center gap-2 font-mono text-[10.5px] text-[#737373]">
                <span>ID: {threadId.slice(0, 8)}...</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(threadId);
                    setCopiedId(true);
                    setTimeout(() => setCopiedId(false), 2000);
                  }}
                  className="hover:text-[#0a0a0a] transition-colors"
                  title="Copy full Thread ID"
                >
                  {copiedId ? (
                    <Check className="w-2.5 h-2.5 text-[#16a34a]" />
                  ) : (
                    <Copy className="w-2.5 h-2.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Center Pipeline Stepper */}
          <div className="hidden md:flex flex-1 max-w-2xl px-4 justify-center">
            <PipelineStepper stages={stages} />
          </div>

          {/* Right Status / Download CTA */}
          <div className="flex items-center gap-2 shrink-0">
            {isCompleted ? (
              <a
                href={getExportUrl(threadId)}
                className="flex items-center gap-1.5 font-mono text-xs font-semibold bg-[#0a0a0a] text-white px-3.5 py-1.5 rounded hover:bg-[#262626] transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .DOCX</span>
              </a>
            ) : isAwaitingReview ? (
              <span className="font-mono text-xs text-[#166534] bg-[#f0fdf4] border border-[#bbf7d0] px-2.5 py-1 rounded font-semibold">
                HITL Review Active
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-mono text-xs text-[#525252] bg-[#fafafa] border border-[#e5e5e5] px-2.5 py-1 rounded">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Autonomous Engine Running</span>
              </span>
            )}
          </div>
        </div>

        {/* RAG Triad Telemetry Strip */}
        {triadEval?.triad_summary && (
          <div className="border-t border-[#f0f0f0] bg-[#fafafa] px-6 py-1.5 flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-6 overflow-x-auto text-[11px]">
              <span className="text-[#737373] uppercase tracking-wider font-semibold">
                RAG Triad Telemetry:
              </span>
              <span className="text-[#0a0a0a]">
                Avg Context Relevance:{" "}
                <strong>
                  {Math.round(triadEval.triad_summary.context_relevance * 100)}%
                </strong>
              </span>
              <span className="text-[#0a0a0a]">
                Avg Groundedness:{" "}
                <strong>
                  {Math.round(triadEval.triad_summary.groundedness * 100)}%
                </strong>
              </span>
              <span className="text-[#0a0a0a]">
                Answer Relevance:{" "}
                <strong>
                  {Math.round(triadEval.triad_summary.answer_relevance * 100)}%
                </strong>
              </span>
            </div>

            <div className="text-[11px] text-[#737373]">
              Redlines Flagged:{" "}
              <strong className="text-[#0a0a0a]">{redlines.length}</strong>
            </div>
          </div>
        )}
      </header>

      {/* ----------------- SPLIT VIEWPORT ----------------- */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane (45%): Source Contract Viewer */}
        <div className="w-[45%] h-full border-r border-[#e5e5e5] bg-white overflow-hidden">
          <ContractViewer
            rawText={rawText}
            clauses={clauses}
            activeClauseId={activeClauseId}
          />
        </div>

        {/* Right Pane (55%): Redline Diff & Approval Queue */}
        <div className="w-[55%] h-full flex flex-col bg-[#fafafa] overflow-hidden">
          {/* Header Bar */}
          <div className="px-6 py-3 border-b border-[#e5e5e5] bg-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#0a0a0a]">
                {isAwaitingReview
                  ? "Human-in-the-Loop Redline Queue"
                  : isCompleted
                  ? "Completed Redline Proposals"
                  : "Live LangGraph Engine Execution"}
              </span>
              {isAwaitingReview && (
                <span className="font-mono text-[10px] text-[#737373] bg-[#f5f5f5] px-2 py-0.5 rounded border border-[#e5e5e5]">
                  {reviewedCount}/{totalCount} Reviewed
                </span>
              )}
            </div>

            {isAwaitingReview && (
              <button
                onClick={handleApproveAll}
                className="flex items-center gap-1 font-mono text-[10.5px] text-[#737373] hover:text-[#0a0a0a] border border-[#e5e5e5] bg-white hover:bg-[#fafafa] px-2.5 py-1 rounded transition-colors"
              >
                <CheckCheck className="w-3 h-3 text-[#166534]" />
                <span>Approve All</span>
              </button>
            )}
          </div>

          {/* Error message banner */}
          {streamError && (
            <div className="m-4 p-3 bg-[#fef2f2] border border-[#fecaca] rounded text-xs text-[#991b1b] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{streamError}</span>
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {!isAwaitingReview && !isCompleted ? (
              /* Live Monospace Execution Terminal */
              <div className="bg-[#0a0a0a] text-[#ededed] font-mono rounded-lg p-4 text-xs space-y-2 border border-[#262626] shadow-sm">
                <div className="flex items-center justify-between pb-2 border-b border-[#262626] text-[#737373] text-[11px]">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>LANGGRAPH AGENT STREAM // REAL-TIME LOG</span>
                  </div>
                  {isStreaming && (
                    <span className="flex items-center gap-1 text-[#16a34a]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a] animate-ping" />
                      STREAMING
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 pt-1">
                  {logs.map((l, i) => (
                    <div key={i} className="log-line flex items-start gap-2 leading-relaxed">
                      <span className="text-[#525252] select-none">{l.timestamp}</span>
                      <span className="text-[#a3a3a3] font-bold">[{l.node}]</span>
                      <span className="text-[#ededed]">{l.message}</span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>

                {logs.length === 0 && (
                  <div className="text-[#525252] py-4 text-center">
                    Initializing LangGraph state and pgvector retriever...
                  </div>
                )}
              </div>
            ) : (
              /* Stacked Redline Proposal Cards */
              <div className="space-y-4 pb-20">
                {redlines.map((redline) => (
                  <RedlineCard
                    key={redline.clause_id}
                    redline={redline}
                    triadScores={
                      triadEval?.triad_summary
                        ? {
                            context_relevance: triadEval.triad_summary.context_relevance,
                            groundedness: triadEval.triad_summary.groundedness,
                          }
                        : undefined
                    }
                    onDecision={handleDecision}
                    onEdit={handleEdit}
                    onHover={(id) => setActiveClauseId(id)}
                    currentDecision={decisions[redline.clause_id] || "PENDING"}
                    editedText={editedRedlines[redline.clause_id]}
                  />
                ))}

                {redlines.length === 0 && (
                  <div className="text-center py-12 text-[#a3a3a3] text-sm">
                    No policy redlines flagged. Contract is compliant with enterprise playbook.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sticky Bottom Action Bar */}
          {isAwaitingReview && (
            <div className="border-t border-[#e5e5e5] bg-white px-6 py-3.5 flex items-center justify-between shrink-0 shadow-sm">
              <div className="text-xs font-mono text-[#525252]">
                <strong>{reviewedCount}</strong> of <strong>{totalCount}</strong> clauses reviewed
                {reviewedCount < totalCount && (
                  <span className="text-[#a3a3a3] ml-2 hidden sm:inline">
                    (Unreviewed default to Approved)
                  </span>
                )}
              </div>

              <button
                onClick={handleFinalizeAndExport}
                disabled={isFinalizing}
                className="flex items-center gap-2 font-mono text-xs font-bold bg-[#0a0a0a] text-white px-5 py-2.5 rounded hover:bg-[#262626] transition-all disabled:opacity-50"
              >
                {isFinalizing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>FINALIZING &amp; GENERATING .DOCX...</span>
                  </>
                ) : (
                  <>
                    <FileCheck2 className="w-3.5 h-3.5" />
                    <span>Finalize &amp; Export Redlined .DOCX</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Completed State Bottom Bar */}
          {isCompleted && (
            <div className="border-t border-[#e5e5e5] bg-[#f0fdf4] px-6 py-3.5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 font-mono text-xs text-[#166534] font-semibold">
                <FileCheck2 className="w-4 h-4" />
                <span>Redline review completed &amp; exported</span>
              </div>
              <a
                href={getExportUrl(threadId)}
                className="flex items-center gap-2 font-mono text-xs font-bold bg-[#0a0a0a] text-white px-4 py-2 rounded hover:bg-[#262626] transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Re-Download .DOCX</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
