from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from api._shared import compute_series_request, handle_options, handle_post


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        handle_options(self)

    def do_POST(self) -> None:
        handle_post(self, compute_series_request)
