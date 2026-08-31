"""Internal HTTP API for the isolated autiobook adapter."""

from __future__ import annotations

import asyncio
import hmac
import os
from functools import lru_cache
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException

from adapter_core import (
    AdapterInputError,
    CONTRACT_VERSION,
    PROVIDER_VERSION,
    validate_request,
)
from autiobook_runtime import AutiobookRuntime, UpstreamError


app = FastAPI(
    title="Narra autiobook adapter",
    version=CONTRACT_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


def _positive_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


@lru_cache(maxsize=1)
def runtime() -> AutiobookRuntime:
    return AutiobookRuntime(
        work_root=os.getenv("AUTIOBOOK_WORK_ROOT", "/work"),
        api_base=os.getenv("AUTIOBOOK_LLM_BASE_URL", ""),
        api_key=os.getenv("AUTIOBOOK_LLM_API_KEY", ""),
        model=os.getenv("AUTIOBOOK_LLM_MODEL", ""),
        timeout_seconds=_positive_int("AUTIOBOOK_TIMEOUT_SECONDS", 3_600, 60, 14_400),
    )


@lru_cache(maxsize=1)
def capacity() -> asyncio.Semaphore:
    return asyncio.Semaphore(_positive_int("AUTIOBOOK_MAX_CONCURRENCY", 1, 1, 16))


def authenticate(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("AUTIOBOOK_ADAPTER_TOKEN", "")
    supplied = authorization.removeprefix("Bearer ") if authorization else ""
    if not expected or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/healthz")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "contractVersion": CONTRACT_VERSION,
        "upstreamRevision": PROVIDER_VERSION,
    }


@app.post("/internal/v1/analyze", dependencies=[Depends(authenticate)])
async def analyze(payload: Any) -> dict[str, Any]:
    try:
        request = validate_request(payload)
    except AdapterInputError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    async with capacity():
        try:
            return await asyncio.to_thread(runtime().analyze, request)
        except UpstreamError as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
