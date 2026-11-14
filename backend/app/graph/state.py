from typing import List, Dict, Any, Optional
from typing_extensions import TypedDict
from pydantic import BaseModel, Field


class ExtractedClause(BaseModel):
    clause_id: str = Field(description="Unique identifier e.g. C1, C2")
    section_title: str = Field(description="Title or topic of clause, e.g. Limitation of Liability")
    original_text: str = Field(description="Exact verbatim excerpt from the contract")
    category: str = Field(description="Category: LIABILITY, IP_OWNERSHIP, TERMINATION, DATA_PRIVACY, OTHER")
    risk_level: str = Field(default="MEDIUM", description="Assessed risk: HIGH, MEDIUM, LOW")


class ClauseList(BaseModel):
    clauses: List[ExtractedClause] = Field(default_factory=list, description="List of extracted contract clauses")


class RedlineProposal(BaseModel):
    clause_id: str = Field(description="Matching clause ID (e.g. C1)")
    clause_title: str = Field(description="Title or topic of the clause")
    original_text: str = Field(description="Original clause text")
    proposed_redline: str = Field(description="Proposed compliant replacement text")
    policy_violation: str = Field(description="Description of policy violation against company playbook")
    risk_assessment: str = Field(default="HIGH", description="Risk severity: HIGH, MEDIUM, LOW")
    justification: str = Field(description="Legal reasoning and reference to policy standards")
    decision: Optional[str] = Field(default="PENDING", description="Human review decision: APPROVED, REJECTED, MODIFIED, PENDING")


class RedlineBatch(BaseModel):
    redlines: List[RedlineProposal] = Field(default_factory=list, description="Collection of drafted redline proposals")


class CritiqueVerdict(BaseModel):
    passed: bool = Field(description="True if redlines meet quality, conciseness, and legal accuracy standards")
    feedback: str = Field(description="Specific feedback on gaps or improvements needed")
    flaws: List[str] = Field(default_factory=list, description="List of identified issues or hallucinations")
    severity: str = Field(default="LOW", description="Overall severity of flaws: HIGH, MEDIUM, LOW")


class TriadEvaluation(BaseModel):
    context_relevance_score: float = Field(ge=0.0, le=1.0, description="RAG Triad: Context Relevance score (0-1)")
    context_relevance_reason: str = Field(description="Evaluation of policy chunk relevance to contract clauses")
    groundedness_score: float = Field(ge=0.0, le=1.0, description="RAG Triad: Groundedness / Faithfulness score (0-1)")
    groundedness_reason: str = Field(description="Evaluation of whether redlines are faithful to retrieved policies")
    answer_relevance_score: float = Field(ge=0.0, le=1.0, description="RAG Triad: Answer Relevance score (0-1)")
    answer_relevance_reason: str = Field(description="Evaluation of whether redlines directly address high-risk clauses")
    triad_summary: Dict[str, Any] = Field(default_factory=dict, description="Summary scorecard for dashboard display")


class ContractState(TypedDict, total=False):
    contract_title: str
    raw_contract_text: str
    clauses: List[Dict[str, Any]]
    retrieved_policies: List[Dict[str, Any]]
    redlines: List[Dict[str, Any]]
    critique_verdict: Optional[Dict[str, Any]]
    critique_history: List[str]
    revision_count: int
    max_revisions: int
    triad_evaluation: Optional[Dict[str, Any]]
    human_decisions: Optional[Dict[str, str]]
    human_edited_redlines: Optional[Dict[str, str]]
    export_path: Optional[str]
    status: str
    error: Optional[str]

