# Semchunk sidecar image (ADR-030). The tiktoken encoding is baked in at build
# time so the container never needs outbound network access at runtime
# (air-gapped deployments, private ECS subnets).
FROM python:3.12-slim

WORKDIR /srv/semchunk

COPY pyproject.toml app.py test_app.py ./
RUN pip install --no-cache-dir ".[test]" \
    && python -m pytest -q \
    && pip uninstall -y pytest httpx

ENV TIKTOKEN_CACHE_DIR=/opt/tiktoken-cache
RUN python -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz', timeout=4)"]

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
