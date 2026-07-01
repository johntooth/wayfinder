"""Tests are the spec for the sidecar's HTTP contract (phase doc §6)."""

import os

os.environ["SEMCHUNK_TOKENIZER"] = "chars"  # keep tests offline — no tiktoken download

from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_healthz_returns_ok():
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chunk_returns_a_list_of_string_chunks():
    text = ("First complete thought. " * 100) + "\n\n" + ("Second complete thought. " * 100)

    response = client.post("/chunk", json={"text": text})

    assert response.status_code == 200
    chunks = response.json()["chunks"]
    assert isinstance(chunks, list)
    assert len(chunks) > 1
    assert all(isinstance(chunk, str) for chunk in chunks)


def test_chunk_respects_max_tokens_sizing():
    text = "A short sentence. " * 200

    small = client.post("/chunk", json={"text": text, "max_tokens": 100}).json()["chunks"]
    large = client.post("/chunk", json={"text": text, "max_tokens": 500}).json()["chunks"]

    assert len(small) > len(large)


def test_chunk_accepts_overlap_tokens():
    text = "A short sentence. " * 200

    response = client.post("/chunk", json={"text": text, "max_tokens": 100, "overlap_tokens": 20})

    assert response.status_code == 200
    assert len(response.json()["chunks"]) > 1


def test_blank_text_returns_empty_chunks():
    response = client.post("/chunk", json={"text": "   \n\n  "})

    assert response.status_code == 200
    assert response.json() == {"chunks": []}


def test_missing_text_is_a_validation_error():
    response = client.post("/chunk", json={"max_tokens": 100})

    assert response.status_code == 422


def test_overlap_must_be_smaller_than_max_tokens():
    response = client.post("/chunk", json={"text": "hello", "max_tokens": 50, "overlap_tokens": 50})

    assert response.status_code == 422


def test_oversized_text_is_rejected():
    oversized = "a" * (2_000_001)

    response = client.post("/chunk", json={"text": oversized})

    assert response.status_code == 413
