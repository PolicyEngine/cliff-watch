from __future__ import annotations

from typing import Any


def create_app():
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse

    from api._shared import (
        DEFAULT_SERIES_MAX_EARNINGS,
        DEFAULT_SERIES_STEP,
        compute_household,
        compute_household_types,
        compute_series,
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
            payload = parse_household_payload(raw_payload)
            response = compute_series(
                payload,
                max_earned_income=int(
                    raw_payload.get(
                        "max_earned_income",
                        DEFAULT_SERIES_MAX_EARNINGS,
                    )
                ),
                step=int(raw_payload.get("step", DEFAULT_SERIES_STEP)),
                min_earned_income=int(raw_payload.get("min_earned_income", 0)),
            )
            return JSONResponse(response)
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
