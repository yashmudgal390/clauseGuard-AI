import os
import logging
from typing import Optional
from dotenv import load_dotenv
from langchain_groq import ChatGroq

load_dotenv()
logger = logging.getLogger("clauseguard.llm")

_RESOLVED_MODEL_ID: Optional[str] = None

# Prioritized list of preferred models for contract extraction and redlining
PREFERRED_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-70b-versatile",
    "llama-3.1-8b-instant",
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "mixtral-8x7b-32768",
]

FALLBACK_MODEL = "qwen/qwen3.8-27b"


def resolve_groq_model_id(force_refresh: bool = False) -> str:
    """
    Resolve an active Groq chat model dynamically via the Groq /models API.
    Caches the result after first resolution.
    """
    global _RESOLVED_MODEL_ID
    if _RESOLVED_MODEL_ID and not force_refresh:
        return _RESOLVED_MODEL_ID

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.warning("GROQ_API_KEY not found in environment; defaulting to fallback model %s", FALLBACK_MODEL)
        _RESOLVED_MODEL_ID = FALLBACK_MODEL
        return _RESOLVED_MODEL_ID

    try:
        from groq import Groq
        client = Groq(api_key=api_key)
        models_response = client.models.list()
        active_model_ids = {m.id for m in models_response.data if getattr(m, "active", True)}

        # Find first matching preferred model
        for candidate in PREFERRED_MODELS:
            if candidate in active_model_ids:
                logger.info("Resolved preferred Groq model: %s", candidate)
                _RESOLVED_MODEL_ID = candidate
                return _RESOLVED_MODEL_ID

        # If none of the preferred models match, pick any active text generation model
        for m_id in active_model_ids:
            lower_id = m_id.lower()
            if not any(skip in lower_id for skip in ["whisper", "guard", "orpheus", "audio", "embed"]):
                logger.info("Resolved active alternative Groq model: %s", m_id)
                _RESOLVED_MODEL_ID = m_id
                return _RESOLVED_MODEL_ID

    except Exception as exc:
        logger.warning("Failed to query Groq /models API (%s); using fallback model %s", exc, FALLBACK_MODEL)

    _RESOLVED_MODEL_ID = FALLBACK_MODEL
    return _RESOLVED_MODEL_ID


def get_llm(temperature: float = 0.0, model_name: Optional[str] = None) -> ChatGroq:
    """
    Returns a configured ChatGroq instance using the dynamically resolved model.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY environment variable is not set.")

    model = model_name or resolve_groq_model_id()
    return ChatGroq(
        model=model,
        temperature=temperature,
        groq_api_key=api_key,
        max_retries=3,
    )

