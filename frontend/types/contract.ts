// ============================================================
// ClauseGuard AI — Shared TypeScript Types
// ============================================================

export type RiskLevel = "HIGH" | "MEDIUM" | "LOW";
export type ClauseDecision = "APPROVED" | "REJECTED" | "MODIFIED" | "PENDING";
export type ClauseCategory =
  | "LIABILITY"
  | "IP_OWNERSHIP"
  | "TERMINATION"
  | "DATA_PRIVACY"
  | "OTHER";

export interface ExtractedClause {
  clause_id: string;
  section_title: string;
  original_text: string;
  category: ClauseCategory;
  risk_level: RiskLevel;
}

export interface RedlineProposal {
  clause_id: string;
  clause_title: string;
  original_text: string;
  proposed_redline: string;
  policy_violation: string;
  risk_assessment: RiskLevel;
  justification: string;
  decision: ClauseDecision;
}

export interface TriadEvaluation {
  context_relevance_score: number;
  context_relevance_reason: string;
  groundedness_score: number;
  groundedness_reason: string;
  answer_relevance_score: number;
  answer_relevance_reason: string;
  triad_summary: {
    context_relevance: number;
    groundedness: number;
    answer_relevance: number;
    composite_score: number;
  };
}

export interface CritiqueVerdict {
  passed: boolean;
  feedback: string;
  flaws: string[];
  severity: RiskLevel;
}

export interface ThreadState {
  thread_id: string;
  status: string;
  contract_title: string;
  raw_contract_text: string;
  clauses: ExtractedClause[];
  redlines: RedlineProposal[];
  triad_evaluation: TriadEvaluation | null;
  critique_verdict: CritiqueVerdict | null;
  revision_count: number;
  export_path: string | null;
  download_url: string | null;
}

export interface StartThreadResponse {
  thread_id: string;
  contract_title: string;
  raw_contract_text: string;
}

export interface SampleContractResponse {
  title: string;
  raw_text: string;
}

export interface HealthResponse {
  status: string;
  model: string;
  db: string;
}

export interface ResumeRequest {
  decisions: Record<string, ClauseDecision>;
  edited_redlines: Record<string, string>;
}

export interface ResumeResponse {
  status: string;
  download_url: string;
}

// SSE Event payloads
export interface SSENodeUpdate {
  node: string;
  status: string;
  revision_count: number;
  critique_feedback: string;
}

export interface SSEInterrupt {
  thread_id: string;
  triad_summary: TriadEvaluation["triad_summary"];
  redlines: RedlineProposal[];
}

export interface SSEError {
  message: string;
}

export type PipelineStage =
  | "extract_clauses"
  | "retrieve_policies"
  | "draft_redlines"
  | "critique_redlines"
  | "evaluate_rag_triad"
  | "human_review"
  | "export_docx";

export type PipelineStatus = "pending" | "running" | "completed" | "error";

export interface PipelineStageState {
  id: PipelineStage;
  label: string;
  status: PipelineStatus;
  revisionCount?: number;
  critiqueFeedback?: string;
}

