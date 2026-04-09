from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from api._shared import handle_options, metadata_response, send_json


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        handle_options(self)

    def do_GET(self) -> None:
        send_json(self, metadata_response(), cache_control="no-store")
