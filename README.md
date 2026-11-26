ClauseGuard AIAutonomous Enterprise Contract Redlining EngineAutonomous legal contract analysis, Small-to-Big RAG playbook retrieval, iterative compliance critique, RAG Triad auditing, and Human-in-the-Loop (HITL) approval—streamed in real time.Watch Live Working Demo • Architecture • Quickstart • Deployment🎥 Live Working DemoSee ClauseGuard AI in action—from contract ingestion and real-time LangGraph state streaming to RAG Triad verification, Human-in-the-Loop redline approvals, and .docx export:👉 Watch the Full Walkthrough Video on Google Drive✨ Key FeaturesAutonomous Cyclic StateGraph (LangGraph): Orchestrates multi-step legal reasoning across clause extraction, retrieval, drafting, compliance self-critique, and quality auditing.Small-to-Big RAG Retrieval: Indexes granular leaf embeddings (~320 chars via BAAI/bge-small-en-v1.5) in pgvector and retrieves full parent playbook sections (~1200 chars) for rich legal context.Automated RAG Triad Evaluation: Audits every generated redline against Context Relevance, Groundedness, and Answer Relevance before presenting changes to the user.Durable Human-in-the-Loop (HITL): Pauses graph execution at critical redline checkpoints using AsyncPostgresSaver, allowing legal reviewers to approve, reject, or modify suggestions before final export.Real-Time SSE Streaming: Streams live agent thoughts, node transitions, and audit scores directly to the split-screen Next.js 14 editorial dashboard via Server-Sent Events.Native .docx Redline Exporter: Compiles approved changes into a formatted Microsoft Word report ready for counterparty review.Resilient Offline Mode: Automatically falls back to an in-memory store if a Supabase instance is not configured during local development.🏗 Architecture Overview                      ┌────────────────────────────────────────┐
                      │    Next.js 14 Monochrome Dashboard     │
                      │ (Split-Screen Viewer & HITL Approvals) │
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
🛠 Tech StackLayerTechnologiesFrontendNext.js 14 (App Router), TypeScript, Tailwind CSS, Server-Sent Events (SSE)BackendPython 3.11+, FastAPI, sse-starlette, pypdf, python-docxAgent OrchestrationLangGraph (StateGraph, AsyncPostgresSaver checkpointing)LLM InferenceGroq API (Llama / Qwen structured outputs)Embeddings & Vector DBHugging Face (BAAI/bge-small-en-v1.5), Supabase PostgreSQL (pgvector)🚀 Local Development Quickstart1. PrerequisitesPython: 3.11 or higherNode.js: 18 or higher (with pnpm)Groq API Key: Get one at console.groq.comSupabase Project: Optional (runs in resilient in-memory mode if omitted)2. Backend Setupcd backend

# Create and activate virtual environment
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
Create a backend/.env file:GROQ_API_KEY=gsk_your_groq_api_key
SUPABASE_DB_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres
FRONTEND_ORIGIN=http://localhost:3000
Start the FastAPI server:uvicorn app.main:app --reload --port 8000
3. Frontend Setupcd frontend

# Install dependencies
pnpm install
Create a frontend/.env.local file:NEXT_PUBLIC_API_URL=http://localhost:8000
Start the Next.js development server:pnpm dev
Open http://localhost:3000 in your browser.🧪 Running Automated TestsRun the backend test suite with pytest:cd backend
python -m pytest -v tests/test_api.py
Test Coverage Includes:Health checks & dynamic Groq model resolution (/api/health)Sample SaaS Master Subscription Agreement loader (/api/sample-contract)PDF & TXT document parsing with [Page N] tagging and 32k context guardrailsEnd-to-end workflow lifecycle: /start ➔ SSE /stream ➔ /state ➔ HITL /resume ➔ Word .docx /export☁️ Production Deployment GuideA. Supabase PostgreSQL ConfigurationCreate a new project at supabase.com.Navigate to Database ➔ Extensions and enable the vector extension.ClauseGuard AI automatically runs schema migrations on startup:playbook_parents: Stores parent chunks (~1200 chars) with section headers and child counts.clauseguard_playbook_leaves: Stores leaf embeddings (~320 chars) generated by BAAI/bge-small-en-v1.5.checkpoints / checkpoint_blobs: Managed automatically by LangGraph's AsyncPostgresSaver.Copy your URI from Project Settings ➔ Database ➔ Connection string (URI mode):postgresql://postgres.[REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
B. Deploying the Backend (Render or Railway)Option 1: RenderCreate a new Web Service linked to your GitHub repository.Set Root Directory to backend.Set Runtime to Python 3 or Docker (uses backend/Dockerfile).Configure Environment Variables:GROQ_API_KEY: Your Groq API keySUPABASE_DB_URL: Your Supabase connection URIFRONTEND_ORIGIN: Your deployed Vercel frontend URL (e.g., https://clauseguard.vercel.app)Start Command: uvicorn app.main:app --host 0.0.0.0 --port $PORT (pre-configured in render.yaml & Procfile).Option 2: RailwayCreate a new project from your GitHub repository and select the /backend root folder.Railway will automatically detect backend/Dockerfile or Procfile.Add GROQ_API_KEY, SUPABASE_DB_URL, and FRONTEND_ORIGIN in the Variables tab.C. Deploying the Frontend (Vercel)Import your repository into vercel.com.Set Root Directory to frontend and Framework Preset to Next.js.Add the Environment Variable:NEXT_PUBLIC_API_URL: Your deployed FastAPI backend URL (e.g., https://clauseguard-backend.onrender.com)Click Deploy.
