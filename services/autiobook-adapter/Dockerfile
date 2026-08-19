FROM python:3.12-slim AS autiobook-source

ARG AUTIOBOOK_COMMIT=d532bdd0a15f2948fd0c99f5e11b92677cb5c3eb

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git ca-certificates \
    && git clone https://github.com/khimaros/autiobook.git /src/autiobook \
    && git -C /src/autiobook checkout --detach "${AUTIOBOOK_COMMIT}" \
    && python -m pip wheel --no-deps --wheel-dir /wheels /src/autiobook \
    && rm -rf /var/lib/apt/lists/*

FROM python:3.12-slim

ARG AUTIOBOOK_COMMIT=d532bdd0a15f2948fd0c99f5e11b92677cb5c3eb

LABEL org.opencontainers.image.title="Narra external book adapter" \
      org.opencontainers.image.source="https://github.com/khimaros/autiobook" \
      org.opencontainers.image.revision="${AUTIOBOOK_COMMIT}" \
      org.opencontainers.image.licenses="GPL-3.0"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AUTIOBOOK_WORK_ROOT=/work

WORKDIR /app
COPY --from=autiobook-source /wheels /wheels
COPY requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir /wheels/* -r /app/requirements.txt \
    && rm -rf /wheels \
    && addgroup --system --gid 10001 adapter \
    && adduser --system --uid 10001 --ingroup adapter adapter \
    && mkdir -p /work \
    && chown adapter:adapter /work

COPY adapter_core.py autiobook_runtime.py server.py /app/

USER adapter
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"]
ENTRYPOINT ["python", "-m", "uvicorn"]
CMD ["server:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
