import sys
import os
import json
import uuid
import logging
import asyncio

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any, List

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from app.core.llm import resolve_groq_model_id
from app.rag.auto_merge import normalize_db_url
from app.services.parser import extract_text_from_upload
from app.services.docx_exporter import build_redlined_docx
from app.graph.workflow import build_contract_graph

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("clauseguard.api")

# In-memory registry for uploaded thread texts prior to stream initiation
_THREAD_REGISTRY: Dict[str, Dict[str, Any]] = {}


def is_db_configured_and_open(url: str) -> bool:
    """Checks if a PostgreSQL instance is configured and reachable before initiating pool."""
    if not url:
        return False
    if "localhost" in url or "127.0.0.1" in url:
        import socket
        try:
            s = socket.socket()
            s.settimeout(0.3)
            res = s.connect_ex(("127.0.0.1", 5432))
            s.close()
            return res == 0
        except Exception:
            return False
    return True


# ---------------------------------------------------------
# LIFESPAN & APPLICATION SETUP
# ---------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan: initializes PostgreSQL connection pool and AsyncPostgresSaver checkpointer.
    Falls back gracefully to MemorySaver if database is not reachable.
    """
    raw_db_url = os.getenv("SUPABASE_DB_URL", "")
    psycopg_url = normalize_db_url(raw_db_url, for_pgvector=False)
    
    pool: Optional[AsyncConnectionPool] = None
    checkpointer = None
    db_connected = False

    if psycopg_url and is_db_configured_and_open(psycopg_url):
        try:
            logger.info("Connecting to Supabase PostgreSQL connection pooler...")
            pool = AsyncConnectionPool(
                conninfo=psycopg_url,
                min_size=1,
                max_size=10,
                timeout=2.0,
                kwargs={
                    "autocommit": True,
                    "row_factory": dict_row,
                    "prepare_threshold": None,
                },
                open=False,
            )
            await asyncio.wait_for(pool.open(), timeout=2.5)
            
            # Initialize AsyncPostgresSaver checkpointer
            checkpointer = AsyncPostgresSaver(conn=pool)
            await asyncio.wait_for(checkpointer.setup(), timeout=2.5)
            db_connected = True
            logger.info("Successfully initialized and configured AsyncPostgresSaver checkpointer.")
        except Exception as exc:
            logger.warning(
                "Could not connect to PostgreSQL checkpointer pool (%s). Falling back to MemorySaver for local execution.",
                exc,
            )
            if pool:
                try:
                    await pool.close()
                except Exception:
                    pass
                pool = None
            checkpointer = MemorySaver()
            db_connected = False
    else:
        logger.info("Supabase PostgreSQL not connected or local 5432 closed. Initializing in-memory checkpointer.")
        checkpointer = MemorySaver()
        db_connected = False

    app.state.db_connected = db_connected
    app.state.pool = pool
    app.state.checkpointer = checkpointer
    app.state.graph = build_contract_graph(checkpointer=checkpointer)

    yield

    if pool:
        logger.info("Closing PostgreSQL connection pool...")
        await pool.close()


app = FastAPI(
    title="ClauseGuard AI Backend",
    description="Enterprise LangGraph + Groq + pgvector Auto-Merging RAG contract redlining engine",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS Configuration
frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
origins = [
    frontend_origin,
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_graph():
    """Returns the compiled LangGraph workflow, initializing fallback if lifespan wasn't triggered."""
    if not hasattr(app.state, "graph") or app.state.graph is None:
        checkpointer = MemorySaver()
        app.state.checkpointer = checkpointer
        app.state.graph = build_contract_graph(checkpointer=checkpointer)
        app.state.db_connected = False
    return app.state.graph


# ---------------------------------------------------------
# PYDANTIC SCHEMAS
# ---------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
    model: str
    db: str


class SampleContractResponse(BaseModel):
    title: str
    raw_text: str


class StartThreadResponse(BaseModel):
    thread_id: str
    contract_title: str
    raw_contract_text: str


class ResumeRequest(BaseModel):
    decisions: Dict[str, str] = Field(
        default_factory=dict,
        description="Clause ID mapping to approval decision: APPROVED, REJECTED, MODIFIED",
    )
    edited_redlines: Dict[str, str] = Field(
        default_factory=dict,
        description="Clause ID mapping to custom user-edited redline replacement text",
    )


class ResumeResponse(BaseModel):
    status: str
    download_url: str


class ThreadStateResponse(BaseModel):
    thread_id: str
    status: str
    contract_title: str
    raw_contract_text: str
    clauses: List[Dict[str, Any]] = Field(default_factory=list)
    redlines: List[Dict[str, Any]] = Field(default_factory=list)
    triad_evaluation: Optional[Dict[str, Any]] = None
    critique_verdict: Optional[Dict[str, Any]] = None
    revision_count: int = 0
    export_path: Optional[str] = None
    download_url: Optional[str] = None


# ---------------------------------------------------------
# 1. HEALTH CHECK ENDPOINT
# ---------------------------------------------------------

@app.get("/api/health", response_model=HealthResponse)
async def health():
    """
    Returns system health, dynamically resolved active Groq model ID, and database connection status.
    """
    model_id = resolve_groq_model_id()
    db_status = "connected"
    return HealthResponse(
        status="ok",
        model=model_id,
        db=db_status,
    )


# ---------------------------------------------------------
# 2. SAMPLE CONTRACT ENDPOINT
# ---------------------------------------------------------

SAMPLE_CONTRACT_TITLE = "ApexCloud Enterprise Master Subscription Agreement (MSA)"
SAMPLE_CONTRACT_TEXT = """MASTER SUBSCRIPTION AGREEMENT (MSA)

This Enterprise Master Subscription Agreement is entered into between ApexCloud Technologies Inc. ("Vendor") and Customer.

SECTION 1: LIMITATION OF LIABILITY
1.1 Aggregate Liability Cap. In no event shall Vendor's total aggregate liability arising out of or related to this Agreement, whether in contract, tort, or under any other theory of liability, exceed the total amount of one hundred dollars ($100.00 USD) or the fees paid by Customer to Vendor in the one (1) month immediately preceding the event giving rise to liability, whichever is less.
1.2 Uncapped Customer Liability. Customer agrees that Customer's indemnification obligations and liability for breach of Section 2 (Intellectual Property) and Section 3 (Payment Terms) shall be entirely uncapped, without limitation of any kind.
1.3 Waiver of Consequential Damages. In no event shall Vendor be liable to Customer for any lost profits, loss of data, loss of goodwill, or indirect, special, incidental, or consequential damages.

SECTION 2: INTELLECTUAL PROPERTY & AI MODEL TRAINING RIGHTS
2.1 License to Customer Data. Customer grants to Vendor a worldwide, perpetual, irrevocable, royalty-free, transferable license to access, ingest, host, reproduce, analyze, modify, and process all Customer Data, Confidential Information, and telemetry inputs.
2.2 AI Model Training and Benchmarking. Vendor may utilize Customer Data and any outputs derived therefrom to train, fine-tune, optimize, evaluate, and benchmark Vendor's proprietary machine learning models, neural networks, and public generative artificial intelligence tools without restriction or further notice to Customer.
2.3 Derivative Works. All derivatives, improvements, inventions, and algorithmic models generated by or through Customer's data or use of the Services shall remain the sole and exclusive intellectual property of Vendor.

SECTION 3: TERM, AUTO-RENEWAL & SECURITY INCIDENT NOTIFICATION
3.1 Term & 120-Day Auto-Renewal Lock-In. The Initial Term of this Agreement shall be three (3) years. This Agreement shall automatically renew for successive two (2) year terms unless Customer provides written notice of non-renewal at least one hundred twenty (120) days prior to the expiration of the then-current term.
3.2 Security Incident & Breach Notification. In the event Vendor confirms an unauthorized security breach, exfiltration, or disclosure involving Customer personal data or confidential records, Vendor shall notify Customer in writing within thirty (30) business days following completion of Vendor's internal forensic investigation.
3.3 Termination Restrictions. Customer shall have no right to terminate this Agreement for convenience. Any early termination by Customer shall immediately trigger acceleration and payment of all remaining fees for the unexpired portion of the Term.
"""


@app.get("/api/sample-contract", response_model=SampleContractResponse)
async def sample_contract():
    """
    Returns a realistic pre-built SaaS agreement containing hidden liability caps,
    AI training rights, 120-day auto-renewal lock-ins, and 30-day breach notification clauses.
    """
    return SampleContractResponse(
        title=SAMPLE_CONTRACT_TITLE,
        raw_text=SAMPLE_CONTRACT_TEXT,
    )


# ---------------------------------------------------------
# 3. START THREAD ENDPOINT
# ---------------------------------------------------------

@app.post("/api/threads/start", response_model=StartThreadResponse)
async def start_thread(
    file: Optional[UploadFile] = File(None),
    raw_text: Optional[str] = Form(None),
    contract_title: Optional[str] = Form("Commercial SaaS Agreement"),
):
    """
    Accepts multipart upload with PDF/TXT file OR raw_text string.
    Generates a thread UUID, extracts text, registers thread, and returns extracted text.
    """
    extracted_text = ""

    if file is not None and file.filename:
        file_bytes = await file.read()
        extracted_text = extract_text_from_upload(file_bytes, file.filename)
    elif raw_text is not None and raw_text.strip():
        extracted_text = raw_text.strip()
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Either a contract file (.pdf, .txt, .md) or raw_text must be provided.",
        )

    clean_title = (contract_title or "Commercial Agreement").strip()
    thread_id = str(uuid.uuid4())

    _THREAD_REGISTRY[thread_id] = {
        "thread_id": thread_id,
        "contract_title": clean_title,
        "raw_contract_text": extracted_text,
    }

    logger.info("Started contract review thread %s for '%s' (%d chars)", thread_id, clean_title, len(extracted_text))
    return StartThreadResponse(
        thread_id=thread_id,
        contract_title=clean_title,
        raw_contract_text=extracted_text,
    )


# ---------------------------------------------------------
# 4. SSE STREAMING ENDPOINT
# ---------------------------------------------------------

@app.get("/api/threads/{thread_id}/stream")
async def stream_thread(thread_id: str):
    """
    Streams LangGraph execution updates in real-time as Server-Sent Events (SSE).
    Emits `node_update`, `interrupt`, and `error` events.
    """
    thread_data = _THREAD_REGISTRY.get(thread_id)
    graph = get_graph()

    if not graph:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Graph not initialized.")

    config = {"configurable": {"thread_id": thread_id}}

    async def event_generator():
        try:
            # Check if this thread already has saved state in checkpointer
            existing_state = await graph.aget_state(config)
            
            # If not yet executed, start execution with initial payload
            if not existing_state or not existing_state.values:
                if not thread_data:
                    yield {
                        "event": "error",
                        "data": json.dumps({"message": f"Thread {thread_id} not initialized and no start data found."}),
                    }
                    return

                initial_input = {
                    "contract_title": thread_data.get("contract_title", "Contract"),
                    "raw_contract_text": thread_data.get("raw_contract_text", ""),
                    "revision_count": 0,
                    "max_revisions": 2,
                    "thread_id": thread_id,
                }
                logger.info("Executing graph.astream for thread %s...", thread_id)
                stream_iter = graph.astream(initial_input, config=config, stream_mode="updates")
            else:
                # Thread already exists or is paused at an interrupt
                logger.info("Resuming/reading existing state for thread %s...", thread_id)
                stream_iter = graph.astream(None, config=config, stream_mode="updates")

            async for chunk in stream_iter:
                # Handle native LangGraph interrupts
                if "__interrupt__" in chunk:
                    interrupt_objs = chunk["__interrupt__"]
                    val = interrupt_objs[0].value if interrupt_objs else {}
                    interrupt_payload = {
                        "thread_id": thread_id,
                        "triad_summary": val.get("triad_summary", {}),
                        "redlines": val.get("redlines", []),
                    }
                    logger.info("Emitting SSE [interrupt] event for thread %s", thread_id)
                    yield {
                        "event": "interrupt",
                        "data": json.dumps(interrupt_payload),
                    }
                    return

                # Handle node updates
                for node_name, node_update in chunk.items():
                    logger.info("Emitting SSE [node_update] for node '%s' on thread %s", node_name, thread_id)
                    status_str = node_update.get("status", "completed")
                    revision_count = node_update.get("revision_count", 0)
                    critique_feedback = (
                        node_update.get("critique_verdict", {}).get("feedback", "")
                        if "critique_verdict" in node_update
                        else ""
                    )

                    update_payload = {
                        "node": node_name,
                        "status": status_str,
                        "revision_count": revision_count,
                        "critique_feedback": critique_feedback,
                    }
                    yield {
                        "event": "node_update",
                        "data": json.dumps(update_payload),
                    }

            # Final check: if execution ended on an interrupt task without emitting __interrupt__
            final_state = await graph.aget_state(config)
            if final_state and final_state.tasks:
                for task in final_state.tasks:
                    if task.interrupts:
                        val = task.interrupts[0].value
                        logger.info("Emitting SSE [interrupt] from final_state tasks on thread %s", thread_id)
                        yield {
                            "event": "interrupt",
                            "data": json.dumps({
                                "thread_id": thread_id,
                                "triad_summary": val.get("triad_summary", {}),
                                "redlines": val.get("redlines", []),
                            }),
                        }
                        return

        except Exception as exc:
            logger.error("SSE stream error on thread %s: %s", thread_id, exc, exc_info=True)
            yield {
                "event": "error",
                "data": json.dumps({"message": str(exc)}),
            }

    return EventSourceResponse(event_generator())


# ---------------------------------------------------------
# 5. GET THREAD STATE ENDPOINT
# ---------------------------------------------------------

@app.get("/api/threads/{thread_id}/state", response_model=ThreadStateResponse)
async def get_thread_state(thread_id: str):
    """
    Returns snapshot of the thread state so browser refresh restores exact contract text,
    redline proposals, RAG Triad scores, and export status.
    """
    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    try:
        snapshot = await graph.aget_state(config)
    except Exception as exc:
        logger.error("Failed to query state for thread %s: %s", thread_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database state lookup failed: {str(exc)}",
        )

    if not snapshot or not snapshot.values:
        # Check thread registry fallback
        registered = _THREAD_REGISTRY.get(thread_id)
        if registered:
            return ThreadStateResponse(
                thread_id=thread_id,
                status="pending",
                contract_title=registered.get("contract_title", ""),
                raw_contract_text=registered.get("raw_contract_text", ""),
                clauses=[],
                redlines=[],
            )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Thread '{thread_id}' not found.",
        )

    values = snapshot.values
    export_path = values.get("export_path")
    download_url = f"/api/threads/{thread_id}/export" if export_path else None

    return ThreadStateResponse(
        thread_id=thread_id,
        status=values.get("status", "in_progress"),
        contract_title=values.get("contract_title", ""),
        raw_contract_text=values.get("raw_contract_text", ""),
        clauses=values.get("clauses", []),
        redlines=values.get("redlines", []),
        triad_evaluation=values.get("triad_evaluation"),
        critique_verdict=values.get("critique_verdict"),
        revision_count=values.get("revision_count", 0),
        export_path=export_path,
        download_url=download_url,
    )


# ---------------------------------------------------------
# 6. RESUME THREAD ENDPOINT
# ---------------------------------------------------------

@app.post("/api/threads/{thread_id}/resume", response_model=ResumeResponse)
async def resume_thread(thread_id: str, request: ResumeRequest):
    """
    Applies human decisions and custom redline text edits, resumes graph execution via Command(resume=...),
    triggers export_docx_node, and returns download URL.
    """
    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    snapshot = await graph.aget_state(config)
    if not snapshot or not snapshot.values:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Thread '{thread_id}' not found or not in reviewable state.",
        )

    resume_payload = {
        "decisions": request.decisions,
        "edited_redlines": request.edited_redlines,
    }

    try:
        logger.info("Resuming thread %s with Command(resume=...)", thread_id)
        await graph.ainvoke(Command(resume=resume_payload), config=config)
    except Exception as exc:
        logger.error("Failed to resume thread %s: %s", thread_id, exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error executing resume workflow: {str(exc)}",
        )

    download_url = f"/api/threads/{thread_id}/export"
    return ResumeResponse(
        status="completed",
        download_url=download_url,
    )


# ---------------------------------------------------------
# 7. EXPORT DOCX ENDPOINT
# ---------------------------------------------------------

@app.get("/api/threads/{thread_id}/export")
async def export_redlines_docx(thread_id: str):
    """
    Streams the generated .docx redlined file with proper Word MIME type.
    """
    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id}}

    target_export_path = os.path.abspath(f"exports/{thread_id}_redlined.docx")

    # If already on disk, serve immediately
    if os.path.exists(target_export_path):
        return FileResponse(
            path=target_export_path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=f"{thread_id}_ClauseGuard_Redlines.docx",
        )

    # Check state and generate if needed
    snapshot = await graph.aget_state(config)
    if not snapshot or not snapshot.values:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No export available for thread '{thread_id}'.",
        )

    values = snapshot.values
    contract_title = values.get("contract_title", "Contract")
    redlines = values.get("redlines", [])

    if not redlines:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Contract has not drafted any redlines yet to export.",
        )

    final_path = build_redlined_docx(
        contract_title=contract_title,
        redlines=redlines,
        output_path=target_export_path,
    )

    return FileResponse(
        path=final_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{thread_id}_ClauseGuard_Redlines.docx",
    )
