from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from api._shared import (
    DEFAULT_SERIES_MAX_EARNINGS,
    DEFAULT_SERIES_STEP,
    compute_household,
    compute_household_types,
    compute_series,
    handle_options,
    metadata_response,
    parse_household_payload,
    read_json_body,
    send_error_json,
    send_json,
)


class DevApiHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        handle_options(self)

    def do_GET(self) -> None:
        if self.path == "/api/metadata":
            send_json(self, metadata_response(), cache_control="no-store")
            return
        send_error_json(self, 404, f"Unknown route: {self.path}")

    def do_POST(self) -> None:
        try:
            payload = read_json_body(self)

            if self.path == "/api/calculate":
                response = {
                    "result": compute_household(parse_household_payload(payload))
                }
            elif self.path == "/api/series":
                response = compute_series(
                    parse_household_payload(payload),
                    max_earned_income=int(
                        payload.get("max_earned_income", DEFAULT_SERIES_MAX_EARNINGS)
                    ),
                    step=int(payload.get("step", DEFAULT_SERIES_STEP)),
                )
            elif self.path == "/api/households":
                response = compute_household_types(
                    parse_household_payload(payload)
                )
            else:
                send_error_json(self, 404, f"Unknown route: {self.path}")
                return
        except Exception as exc:
            send_error_json(self, 500, f"Calculation failed: {exc}")
            return

        send_json(self, response, cache_control="no-store")

    def log_message(self, format: str, *args: Any) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8000), DevApiHandler)
    print("Dev API server listening on http://127.0.0.1:8000", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
