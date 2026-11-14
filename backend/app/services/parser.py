import io
import os
import logging
from typing import Optional
from fastapi import HTTPException, status
import pypdf

logger = logging.getLogger("clauseguard.parser")

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_SAFE_TOKENS = 32_000
CHARS_PER_TOKEN_ESTIMATE = 4
MAX_SAFE_CHARS = MAX_SAFE_TOKENS * CHARS_PER_TOKEN_ESTIMATE  # ~128,000 chars


def extract_text_from_upload(file_bytes: bytes, filename: str) -> str:
    """
    Extracts clean text from uploaded files (.pdf, .txt, .md).
    Enforces a 10 MB maximum upload size.
    Raises HTTP 422 if PDF is empty/scanned with 0 extractable characters.
    Truncates and logs a clean warning if token count exceeds safe context limits.
    """
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file is empty (0 bytes).",
        )

    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File size ({len(file_bytes)} bytes) exceeds maximum allowable limit of 10 MB.",
        )

    _, ext = os.path.splitext(filename.lower())
    extracted_text = ""

    if ext == ".pdf":
        try:
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            num_pages = len(reader.pages)
            if num_pages == 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Uploaded PDF has 0 pages.",
                )

            page_texts = []
            for page_idx, page in enumerate(reader.pages):
                txt = page.extract_text() or ""
                cleaned = txt.strip()
                if cleaned:
                    page_texts.append(f"[Page {page_idx + 1}]\n{cleaned}")

            extracted_text = "\n\n".join(page_texts).strip()

            if not extracted_text or len(extracted_text) == 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="The uploaded PDF appears to be scanned or contains no extractable text. Please upload a digital PDF.",
                )

        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Failed to parse PDF '%s': %s", filename, exc)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Failed to extract text from PDF document: {str(exc)}",
            )

    elif ext in [".txt", ".md"]:
        try:
            extracted_text = file_bytes.decode("utf-8").strip()
        except UnicodeDecodeError:
            try:
                extracted_text = file_bytes.decode("latin-1").strip()
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Could not decode text file: {str(exc)}",
                )

        if not extracted_text:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The uploaded text file is empty.",
            )

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format '{ext}'. Supported formats: .pdf, .txt, .md",
        )

    # Context window guardrail: check token count estimate
    estimated_tokens = len(extracted_text) // CHARS_PER_TOKEN_ESTIMATE
    if estimated_tokens > MAX_SAFE_TOKENS:
        logger.warning(
            "Contract length (~%d tokens) exceeds safe threshold (%d tokens). Truncating document safely.",
            estimated_tokens,
            MAX_SAFE_TOKENS,
        )
        extracted_text = (
            extracted_text[:MAX_SAFE_CHARS]
            + f"\n\n[WARNING: Contract truncated to {MAX_SAFE_TOKENS:,} tokens for safe LLM processing.]"
        )

    return extracted_text

