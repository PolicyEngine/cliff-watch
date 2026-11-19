from __future__ import annotations

from typing import Any


def create_app():
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse

    from api._shared import (
        compute_household,
        compute_household_types,
        compute_series_request,
        metadata_response,
        parse_household_payload,
    )

    app = FastAPI(title="CliffWatch API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/")
    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/metadata")
    async def metadata() -> dict[str, Any]:
        return metadata_response()

    @app.post("/api/calculate")
    async def calculate(request: Request) -> JSONResponse:
        try:
            raw_payload = await request.json()
            payload = parse_household_payload(raw_payload)
            return JSONResponse({"result": compute_household(payload)})
        except Exception as exc:
            return JSONResponse(
                {"error": f"Calculation failed: {exc}"},
                status_code=500,
            )

    @app.post("/api/series")
    async def series(request: Request) -> JSONResponse:
        try:
            raw_payload = await request.json()
            return JSONResponse(compute_series_request(raw_payload))
        except Exception as exc:
            return JSONResponse(
                {"error": f"Calculation failed: {exc}"},
                status_code=500,
            )

    @app.post("/api/households")
    async def households(request: Request) -> JSONResponse:
        try:
            raw_payload = await request.json()
            payload = parse_household_payload(raw_payload)
            return JSONResponse(compute_household_types(payload))
        except Exception as exc:
            return JSONResponse(
                {"error": f"Calculation failed: {exc}"},
                status_code=500,
            )

    return app
