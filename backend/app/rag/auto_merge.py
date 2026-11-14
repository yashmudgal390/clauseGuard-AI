import os
import re
import logging
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings

from app.rag.playbook import DEFAULT_COMPLIANCE_PLAYBOOK

load_dotenv()
logger = logging.getLogger("clauseguard.rag")

PARENT_TABLE_NAME = "playbook_parents"
LEAF_COLLECTION_NAME = "clauseguard_playbook_leaves"
DEFAULT_PLAYBOOK_ID = "default_playbook"


def normalize_db_url(url: Optional[str], for_pgvector: bool = False) -> str:
    """
    Normalizes database connection strings for psycopg and PGVector.
    AsyncPostgresSaver & psycopg: postgresql://...
    PGVector (SQLAlchemy): postgresql+psycopg://...
    """
    if not url:
        return ""
    clean = url.strip()
    if for_pgvector:
        if clean.startswith("postgres://"):
            return "postgresql+psycopg://" + clean[len("postgres://"):]
        if clean.startswith("postgresql://") and not clean.startswith("postgresql+psycopg://"):
            return "postgresql+psycopg://" + clean[len("postgresql://"):]
        return clean
    else:
        if clean.startswith("postgres://"):
            return "postgresql://" + clean[len("postgres://"):]
        if clean.startswith("postgresql+psycopg://"):
            return "postgresql://" + clean[len("postgresql+psycopg://"):]
        return clean


class AutoMergingPlaybookRetriever:
    """
    Small-to-Big Auto-Merging Playbook Retriever backed by Supabase PostgreSQL (pgvector).
    Splits compliance playbooks into Parent sections (~1200 chars) stored in `playbook_parents`
    and Leaf chunks (~320 chars) embedded with BAAI/bge-small-en-v1.5 in PGVector.
    """

    def __init__(
        self,
        db_url: Optional[str] = None,
        embedding_model_name: str = "BAAI/bge-small-en-v1.5",
        merge_threshold: float = 0.4,
    ):
        self.raw_db_url = db_url or os.getenv("SUPABASE_DB_URL", "")
        self.merge_threshold = merge_threshold
        self.embedding_model_name = embedding_model_name
        self.embeddings = HuggingFaceEmbeddings(model_name=self.embedding_model_name)
        
        self.is_db_connected = False
        self.pgvector = None
        
        # In-memory fallback stores if database is not reachable
        self._in_memory_parents: Dict[str, Dict[str, Any]] = {}
        self._in_memory_leaves: List[Dict[str, Any]] = []

        self._init_storage()

    def _init_storage(self) -> None:
        """Attempts to initialize PostgreSQL connection or falls back to in-memory store."""
        if not self.raw_db_url:
            logger.info("SUPABASE_DB_URL not configured. Operating in in-memory mode.")
            self._init_in_memory_store()
            return

        if "localhost" in self.raw_db_url or "127.0.0.1" in self.raw_db_url:
            import socket
            s = socket.socket()
            s.settimeout(0.3)
            is_open = (s.connect_ex(("127.0.0.1", 5432)) == 0)
            s.close()
            if not is_open:
                logger.info("Local PostgreSQL (port 5432) not active. Operating in in-memory mode.")
                self._init_in_memory_store()
                return

        try:
            import psycopg
            from langchain_postgres.vectorstores import PGVector

            psycopg_url = normalize_db_url(self.raw_db_url, for_pgvector=False)
            pgv_url = normalize_db_url(self.raw_db_url, for_pgvector=True)

            # Test connection and ensure parent table exists
            with psycopg.connect(psycopg_url, connect_timeout=3) as conn:
                with conn.cursor() as cur:
                    cur.execute(f"""
                        CREATE TABLE IF NOT EXISTS {PARENT_TABLE_NAME} (
                            parent_id TEXT PRIMARY KEY,
                            playbook_id TEXT,
                            section_header TEXT,
                            content TEXT,
                            child_count INT
                        );
                    """)
                    conn.commit()

            # Initialize PGVector
            self.pgvector = PGVector(
                embeddings=self.embeddings,
                collection_name=LEAF_COLLECTION_NAME,
                connection=pgv_url,
                use_jsonb=True,
                create_extension=True,
            )
            self.is_db_connected = True
            logger.info("Successfully connected to Supabase PostgreSQL vector store.")

            # Idempotent indexing
            self.ensure_default_playbook_indexed()

        except Exception as exc:
            logger.warning(
                "Could not connect to PostgreSQL (%s). Falling back to resilient in-memory store.",
                exc,
            )
            self.is_db_connected = False
            self.pgvector = None
            self._init_in_memory_store()

    def _split_into_parents_and_leaves(self, playbook_text: str):
        """
        Splits playbook into Parent sections (~1200 chars) and Leaf chunks (~320 chars).
        """
        sections = re.split(r"\n(?=## SECTION \d+:)", playbook_text.strip())
        parent_splitter = RecursiveCharacterTextSplitter(chunk_size=1200, chunk_overlap=100)
        leaf_splitter = RecursiveCharacterTextSplitter(chunk_size=320, chunk_overlap=40)

        parents_data = []
        leaves_data = []

        parent_idx = 1
        for sec in sections:
            sec = sec.strip()
            if not sec:
                continue

            header_match = re.search(r"## SECTION \d+:[^\n]+", sec)
            section_header = header_match.group(0).strip("# ").strip() if header_match else f"Section {parent_idx}"

            parent_chunks = parent_splitter.split_text(sec)
            for p_chunk in parent_chunks:
                parent_id = f"parent_{parent_idx}"
                parent_idx += 1

                child_chunks = leaf_splitter.split_text(p_chunk)
                child_count = len(child_chunks)

                parents_data.append({
                    "parent_id": parent_id,
                    "playbook_id": DEFAULT_PLAYBOOK_ID,
                    "section_header": section_header,
                    "content": p_chunk,
                    "child_count": child_count,
                })

                for c_idx, c_text in enumerate(child_chunks):
                    leaves_data.append(Document(
                        page_content=c_text,
                        metadata={
                            "parent_id": parent_id,
                            "child_index": c_idx,
                            "section_header": section_header,
                            "playbook_id": DEFAULT_PLAYBOOK_ID,
                        }
                    ))

        return parents_data, leaves_data

    def ensure_default_playbook_indexed(self) -> None:
        """
        Idempotent indexing: checks if `playbook_parents` already has rows for
        `default_playbook`. If present, skip re-embedding so startup takes <1 sec.
        """
        if not self.is_db_connected or not self.pgvector:
            return

        try:
            import psycopg
            psycopg_url = normalize_db_url(self.raw_db_url, for_pgvector=False)
            with psycopg.connect(psycopg_url, connect_timeout=3) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        f"SELECT COUNT(*) FROM {PARENT_TABLE_NAME} WHERE playbook_id = %s;",
                        (DEFAULT_PLAYBOOK_ID,),
                    )
                    row = cur.fetchone()
                    count = row[0] if row else 0

            if count > 0:
                logger.info("Default playbook already indexed (%d parent records found). Fast boot active.", count)
                return

            logger.info("Indexing default compliance playbook into Supabase PostgreSQL...")
            parents, leaves = self._split_into_parents_and_leaves(DEFAULT_COMPLIANCE_PLAYBOOK)

            with psycopg.connect(psycopg_url, connect_timeout=5) as conn:
                with conn.cursor() as cur:
                    for p in parents:
                        cur.execute(
                            f"""
                            INSERT INTO {PARENT_TABLE_NAME} (parent_id, playbook_id, section_header, content, child_count)
                            VALUES (%s, %s, %s, %s, %s)
                            ON CONFLICT (parent_id) DO NOTHING;
                            """,
                            (p["parent_id"], p["playbook_id"], p["section_header"], p["content"], p["child_count"]),
                        )
                    conn.commit()

            self.pgvector.add_documents(leaves)
            logger.info("Successfully indexed %d parents and %d leaves into pgvector.", len(parents), len(leaves))

        except Exception as exc:
            logger.error("Error during default playbook indexing: %s", exc)

    def _init_in_memory_store(self) -> None:
        """Populates in-memory storage for test/offline environments."""
        parents, leaves = self._split_into_parents_and_leaves(DEFAULT_COMPLIANCE_PLAYBOOK)
        for p in parents:
            self._in_memory_parents[p["parent_id"]] = p

        texts = [doc.page_content for doc in leaves]
        vectors = self.embeddings.embed_documents(texts)
        for doc, vec in zip(leaves, vectors):
            self._in_memory_leaves.append({
                "document": doc,
                "vector": vec,
            })
        logger.info("In-memory playbook initialized with %d parents and %d leaves.", len(parents), len(leaves))

    def _get_parent_record(self, parent_id: str) -> Optional[Dict[str, Any]]:
        """Fetches parent record from database or in-memory dictionary."""
        if self.is_db_connected:
            try:
                import psycopg
                psycopg_url = normalize_db_url(self.raw_db_url, for_pgvector=False)
                with psycopg.connect(psycopg_url, connect_timeout=3) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            f"SELECT parent_id, playbook_id, section_header, content, child_count FROM {PARENT_TABLE_NAME} WHERE parent_id = %s;",
                            (parent_id,),
                        )
                        row = cur.fetchone()
                        if row:
                            return {
                                "parent_id": row[0],
                                "playbook_id": row[1],
                                "section_header": row[2],
                                "content": row[3],
                                "child_count": row[4],
                            }
            except Exception as e:
                logger.error("Failed to fetch parent %s from database: %s", parent_id, e)

        return self._in_memory_parents.get(parent_id)

    def retrieve(self, query: str, top_k: int = 6) -> List[Dict[str, Any]]:
        """
        Executes Small-to-Big Auto-Merging retrieval:
        1. Retrieve top-k leaf chunks based on vector similarity.
        2. Group retrieved leaves by parent_id.
        3. If (len(leaves) / child_count >= merge_threshold) OR (len(leaves) >= 2):
           Promote to full Parent section tagged with merged=True.
        4. Otherwise, return individual leaf chunks tagged with merged=False.
        """
        retrieved_leaves: List[tuple[Document, float]] = []

        if self.is_db_connected and self.pgvector:
            try:
                results = self.pgvector.similarity_search_with_score(query, k=top_k)
                retrieved_leaves = results
            except Exception as exc:
                logger.warning("PGVector query failed (%s); falling back to in-memory search.", exc)

        if not retrieved_leaves and self._in_memory_leaves:
            # In-memory cosine similarity
            import numpy as np
            q_vec = np.array(self.embeddings.embed_query(query))
            scores = []
            for item in self._in_memory_leaves:
                leaf_vec = np.array(item["vector"])
                cos_sim = float(np.dot(q_vec, leaf_vec) / (np.linalg.norm(q_vec) * np.linalg.norm(leaf_vec) + 1e-9))
                scores.append((item["document"], cos_sim))
            scores.sort(key=lambda x: x[1], reverse=True)
            retrieved_leaves = scores[:top_k]

        # Group leaves by parent_id
        parent_groups: Dict[str, List[tuple[Document, float]]] = {}
        for doc, score in retrieved_leaves:
            p_id = doc.metadata.get("parent_id")
            if p_id:
                parent_groups.setdefault(p_id, []).append((doc, score))

        merged_results: List[Dict[str, Any]] = []
        seen_parents = set()

        for p_id, group in parent_groups.items():
            parent_record = self._get_parent_record(p_id)
            if not parent_record:
                for doc, score in group:
                    merged_results.append({
                        "content": doc.page_content,
                        "section_header": doc.metadata.get("section_header", ""),
                        "parent_id": p_id,
                        "merged": False,
                        "score": score,
                    })
                continue

            child_count = max(parent_record.get("child_count", 1), 1)
            group_size = len(group)
            ratio = group_size / child_count

            # Auto-merging condition: ratio >= threshold OR >= 2 leaves retrieved from same parent
            should_merge = (ratio >= self.merge_threshold) or (group_size >= 2)

            if should_merge:
                if p_id not in seen_parents:
                    seen_parents.add(p_id)
                    avg_score = sum(s for _, s in group) / len(group)
                    merged_results.append({
                        "content": parent_record["content"],
                        "section_header": parent_record.get("section_header", ""),
                        "parent_id": p_id,
                        "merged": True,
                        "score": avg_score,
                    })
            else:
                for doc, score in group:
                    merged_results.append({
                        "content": doc.page_content,
                        "section_header": doc.metadata.get("section_header", ""),
                        "parent_id": p_id,
                        "merged": False,
                        "score": score,
                    })

        return merged_results
