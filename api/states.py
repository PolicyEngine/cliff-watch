from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from api._shared import (
    compute_states,
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
            lambda raw_payload: compute_states(parse_household_payload(raw_payload)),
        )
