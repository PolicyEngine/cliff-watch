from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from api._shared import (
    DEFAULT_SERIES_MAX_EARNINGS,
    DEFAULT_SERIES_STEP,
    compute_series,
    handle_options,
    handle_post,
    parse_household_payload,
)


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        handle_options(self)

    def do_POST(self) -> None:
        handle_post(
            self,
            lambda raw_payload: compute_series(
                parse_household_payload(raw_payload),
                max_earned_income=int(
                    raw_payload.get("max_earned_income", DEFAULT_SERIES_MAX_EARNINGS)
                ),
                step=int(raw_payload.get("step", DEFAULT_SERIES_STEP)),
            ),
        )
