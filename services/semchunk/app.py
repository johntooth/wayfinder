"""Semchunk sidecar (ADR-030): a minimal HTTP wrapper around the `semchunk`
library so Wayfinder's TypeScript adapters can request semantic chunking
without a Python dependency in the Node runtime. Internal-only service —
never expose it on a public load balancer.
"""

import logging
import os
from functools import lru_cache
from typing import Callable

import semchunk
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("semchunk-sidecar")

MAX_INPUT_BYTES = int(os.environ.get("SEMCHUNK_MAX_INPUT_BYTES", 2_000_000))

# Mirrors the TypeScript fallback chunker's 4-chars-per-token approximation so
# both chunkers target comparable sizes when no real tokenizer is available.
CHARS_PER_TOKEN = 4


def approximate_token_count(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


def resolve_token_counter() -> "Callable[[str], int] | object":
    """Prefer a real tiktoken encoding; fall back to the character
    approximation when the encoding cannot be loaded (offline / air-gapped
    without a baked cache)."""
    tokenizer_name = os.environ.get("SEMCHUNK_TOKENIZER", "cl100k_base")
    if tokenizer_name == "chars":
        return approximate_token_count
    try:
        import tiktoken

        return tiktoken.get_encoding(tokenizer_name)
    except Exception:  # noqa: BLE001 — any load failure degrades, never crashes
        logger.warning(
            "could not load tiktoken encoding %r — falling back to character approximation",
            tokenizer_name,
        )
        return approximate_token_count


@lru_cache(maxsize=8)
def chunker_for(max_tokens: int):
    return semchunk.chunkerify(resolve_token_counter(), max_tokens)


class ChunkRequest(BaseModel):
    text: str
    max_tokens: int = Field(default=500, ge=1)
    overlap_tokens: int = Field(default=50, ge=0)


class ChunkResponse(BaseModel):
    chunks: list[str]


app = FastAPI(title="Wayfinder semchunk sidecar")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chunk", response_model=ChunkResponse)
def chunk(request: ChunkRequest) -> ChunkResponse:
    if len(request.text.encode("utf-8")) > MAX_INPUT_BYTES:
        raise HTTPException(status_code=413, detail=f"text exceeds {MAX_INPUT_BYTES} bytes")
    if request.overlap_tokens >= request.max_tokens:
        raise HTTPException(status_code=422, detail="overlap_tokens must be less than max_tokens")
    if request.text.strip() == "":
        return ChunkResponse(chunks=[])

    overlap = request.overlap_tokens if request.overlap_tokens > 0 else None
    chunks = chunker_for(request.max_tokens)(request.text, overlap=overlap)
    return ChunkResponse(chunks=chunks)
