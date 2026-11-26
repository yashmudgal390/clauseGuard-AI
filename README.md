# ClauseGuard AI — Autonomous Contract Redlining Engine

[![Python](https://img.shields.io/badge/Python-3.11+-000000?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-Async-000000?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![LangGraph](https://img.shields.io/badge/LangGraph-Stateful_Agents-000000?style=flat-square)](https://langchain-ai.github.io/langgraph/)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-pgvector-000000?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)

**ClauseGuard AI** is an autonomous enterprise contract redlining engine powered by **LangGraph**, **Groq (Llama / Qwen)**, **Hugging Face (`BAAI/bge-small-en-v1.5`)**, **Supabase PostgreSQL (`pgvector` + `AsyncPostgresSaver`)**, **Server-Sent Events (SSE)**, and a **Next.js 14 monochrome editorial interface**.

---

## Live Demo

**[Watch the Working Project Walkthrough (Google Drive)](https://drive.google.com/file/d/1wlci77aaozSFiAOB5Mp1w1eS8srxgS6Q/view?usp=sharing)**

*(Tip: To embed a playable video player directly on GitHub, drag and drop your `.mp4` recording right below this line in GitHub's web editor.)*

---

## Key Features

- **Autonomous Cyclic Redlining Pipeline:** Extracts clauses via structured LLM outputs, retrieves corporate playbook rules, drafts redlines, and runs iterative compliance critique loops.
- **Small-to-Big Hierarchical RAG:** Queries granular leaf embeddings (`~320 chars` via `BAAI/bge-small-en-v1.5`) in `pgvector` and hydrates full parent playbook sections (`~1200 chars`) for rich legal context.
- **RAG Triad Audit:** Evaluates every drafted redline across **Context Relevance**, **Groundedness**, and **Answer Relevance** before human review.
- **Durable Human-in-the-Loop (HITL):** Pauses graph execution via `AsyncPostgresSaver` checkpoints, allowing legal reviewers to approve, reject, or modify redlines in a split-screen UI before resuming.
- **Real-Time SSE Streaming:** Streams live agent state transitions, compliance critiques, and audit scores directly to the Next.js dashboard via `sse-starlette`.
- **Clean `.docx` Export:** Generates downloadable Word reports with redlined clauses, rationales, and audit metadata.

---

## Architecture Overview

```text
                      ┌────────────────────────────────────────┐
                      │    Next.js 14 Monochrome Dashboard     │
                      │  (Split-Screen Viewer & HITL Approvals) │
                      └──────────────────┬─────────────────────┘
                                         │
             SSE Stream & REST API       ▼
                      ┌────────────────────────────────────────┐
                      │      FastAPI Asynchronous Engine       │
                      │ (pypdf, python-docx, sse-starlette)    │
                      └──────────────────┬─────────────────────┘
                                         │
                        LangGraph Cyclic StateGraph
                                         │
      ┌──────────────────────────────────┴──────────────────────────────────┐
      ▼                                  ▼                                  ▼
[Extract Clauses]              [Small-to-Big RAG]                  [Draft Redlines]
(Groq Structured)           (pgvector + Supabase)                 (Iterative Loop)
      │                                  │                                  │
      └──────────────────────────────────┼──────────────────────────────────┘
                                         │
                           [Compliance Critique Loop]
                                         │
                                [RAG Triad Audit]
                      (Context Rel, Groundedness, Answer)
                                         │
                         [Human-in-the-Loop Interrupt]
                           (Durable Postgres Saver)
                                         │
                             [DOCX Report Exporter]
