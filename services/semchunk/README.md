# Semchunk Sidecar

Semantic chunking service for Wayfinder (ADR-030). Wraps the Python
[`semchunk`](https://pypi.org/project/semchunk/) library behind a minimal HTTP
API so the TypeScript indexing pipeline can request "complete thought" chunks
without a Python dependency in the Node runtime.

**Internal-only.** Never expose this service on a public load balancer — it is
called solely by the Wayfinder web service.

## API

```
POST /chunk
  { "text": string, "max_tokens": int = 500, "overlap_tokens": int = 50 }
  → 200 { "chunks": string[] }        // [] for empty/whitespace text
  → 422 missing/invalid fields, or overlap_tokens >= max_tokens
  → 413 text over SEMCHUNK_MAX_INPUT_BYTES (default 2 MB)

GET /healthz → 200 { "status": "ok" }
```

## Configuration

| Env var | Default | Purpose |
| ------- | ------- | ------- |
| `SEMCHUNK_TOKENIZER` | `cl100k_base` | tiktoken encoding used for token counting; `chars` forces the offline 4-chars-per-token approximation |
| `SEMCHUNK_MAX_INPUT_BYTES` | `2000000` | request size cap |

If the tiktoken encoding cannot be loaded (offline without a baked cache) the
service logs a warning and degrades to the character approximation — it never
fails to start.

## Enabling it in Wayfinder

Set on the web app (see `.env.example`):

```
CHUNKER_PROVIDER=semchunk
SEMCHUNK_URL=http://localhost:8000
```

Locally: `docker compose --profile semchunk up`. On AWS: set
`enable_semchunk = true` in `infra/aws` (see `infra/aws/README.md`), which
deploys the service and wires the web task's env vars automatically.

Wayfinder falls back to its in-process fixed-window chunker whenever this
service is unreachable, so indexing degrades rather than fails.

## Development

```
python -m venv .venv && .venv/bin/pip install -e ".[test]"
.venv/bin/pytest          # tests are the spec for the HTTP contract
.venv/bin/uvicorn app:app --port 8000
```
