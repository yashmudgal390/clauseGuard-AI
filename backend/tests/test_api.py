import io
import json
import pytest
from httpx import AsyncClient, ASGITransport
import pypdf

from app.main import app
from app.services.parser import extract_text_from_upload


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.asyncio
async def test_health():
    """Verifies GET /api/health returns status ok, resolved model, and db status."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=60.0) as client:
        response = await client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "model" in data and len(data["model"]) > 0
        assert data["db"] == "connected"


@pytest.mark.asyncio
async def test_sample_contract():
    """Verifies GET /api/sample-contract returns complete 3-section SaaS contract."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=60.0) as client:
        response = await client.get("/api/sample-contract")
        assert response.status_code == 200
        data = response.json()
        assert "title" in data
        assert "raw_text" in data
        raw_text = data["raw_text"]
        assert "LIMITATION OF LIABILITY" in raw_text
        assert "AI Model Training" in raw_text
        assert "120-Day Auto-Renewal" in raw_text
        assert "Breach Notification" in raw_text


def test_parser_service():
    """Verifies file validation, text parsing, and context guardrails."""
    # 1. Plain text and markdown parsing
    sample_txt = b"This is a test contract for ClauseGuard AI."
    extracted = extract_text_from_upload(sample_txt, "contract.txt")
    assert extracted == "This is a test contract for ClauseGuard AI."

    # 2. Rejection of unsupported file extension
    with pytest.raises(Exception) as excinfo:
        extract_text_from_upload(sample_txt, "contract.exe")
    assert "400" in str(excinfo.value)

    # 3. Context window guardrail (>32,000 tokens)
    huge_text = ("Clause paragraph with liability details. " * 5000).encode("utf-8")
    truncated = extract_text_from_upload(huge_text, "huge.txt")
    assert "[WARNING: Contract truncated" in truncated

    # 4. Empty / scanned PDF validation
    # Create empty PDF in memory
    writer = pypdf.PdfWriter()
    buf = io.BytesIO()
    writer.write(buf)
    empty_pdf_bytes = buf.getvalue()

    with pytest.raises(Exception) as excinfo:
        extract_text_from_upload(empty_pdf_bytes, "scanned.pdf")
    assert "422" in str(excinfo.value)


@pytest.mark.asyncio
async def test_start_thread_validations():
    """Verifies POST /api/threads/start with valid and invalid payloads."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=60.0) as client:
        # Invalid: no file or raw_text
        bad_resp = await client.post("/api/threads/start", data={})
        assert bad_resp.status_code == 422

        # Valid: with raw_text
        good_resp = await client.post(
            "/api/threads/start",
            data={
                "contract_title": "Enterprise Cloud Agreement",
                "raw_text": "Section 1: Vendor liability shall not exceed $50.",
            },
        )
        assert good_resp.status_code == 200
        data = good_resp.json()
        assert "thread_id" in data
        assert data["contract_title"] == "Enterprise Cloud Agreement"
        assert "Vendor liability" in data["raw_contract_text"]


@pytest.mark.asyncio
async def test_full_lifecycle_pipeline():
    """
    End-to-end integration test verifying the full lifecycle:
    1. POST /api/threads/start
    2. GET /api/threads/{thread_id}/stream (SSE events stream up to interrupt)
    3. GET /api/threads/{thread_id}/state
    4. POST /api/threads/{thread_id}/resume
    5. GET /api/threads/{thread_id}/export (Word .docx download)
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=60.0) as client:
        # Step 1: Start Thread
        start_resp = await client.post(
            "/api/threads/start",
            data={
                "contract_title": "SaaS Pilot Master Agreement",
                "raw_text": (
                    "SECTION 1: Vendor liability is capped at $10. "
                    "SECTION 2: Vendor may freely use customer data to train AI models. "
                    "SECTION 3: Contract auto-renews unless customer cancels 120 days in advance."
                ),
            },
        )
        assert start_resp.status_code == 200
        start_data = start_resp.json()
        thread_id = start_data["thread_id"]
        assert thread_id

        # Step 2: Stream LangGraph execution via SSE
        stream_resp = await client.get(f"/api/threads/{thread_id}/stream")
        assert stream_resp.status_code == 200
        assert "text/event-stream" in stream_resp.headers["content-type"]

        body_text = stream_resp.text
        # Verify node updates were emitted
        assert "event: node_update" in body_text or "event: interrupt" in body_text

        # Step 3: Query durable state snapshot
        state_resp = await client.get(f"/api/threads/{thread_id}/state")
        assert state_resp.status_code == 200
        state_data = state_resp.json()
        assert state_data["thread_id"] == thread_id
        assert len(state_data["redlines"]) > 0

        # Step 4: Resume human review with decisions and custom redline edits
        first_clause_id = state_data["redlines"][0]["clause_id"]
        resume_payload = {
            "decisions": {first_clause_id: "APPROVED"},
            "edited_redlines": {first_clause_id: "Mutual aggregate liability is capped at 12 months fees paid."},
        }
        resume_resp = await client.post(f"/api/threads/{thread_id}/resume", json=resume_payload)
        assert resume_resp.status_code == 200
        resume_data = resume_resp.json()
        assert resume_data["status"] == "completed"
        assert resume_data["download_url"] == f"/api/threads/{thread_id}/export"

        # Step 5: Export and verify .docx file stream
        export_resp = await client.get(f"/api/threads/{thread_id}/export")
        assert export_resp.status_code == 200
        assert (
            export_resp.headers["content-type"]
            == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        # Word .docx files are PKZIP archives; assert PK header
        assert export_resp.content.startswith(b"PK\x03\x04")
