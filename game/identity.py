"""Whose save file a request uses.

The person running the server (browsing from this computer) uses the main
save file. Friends who join over the network each get their own guest save
file, picked by a cookie, so they keep their own name, colour and records and
can't change the host's.
"""
from __future__ import annotations

import os
import re
import uuid

from flask import current_app, request

GUEST_COOKIE = "wobble_guest"
_GUEST_ID = re.compile(r"^[0-9a-f]{32}$")
_LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def is_local() -> bool:
    """True when the request comes from the computer running the server.

    Tunnels and proxies (which add X-Forwarded-For) count as remote even though
    they connect from 127.0.0.1.
    """
    return request.remote_addr in _LOOPBACK and "X-Forwarded-For" not in request.headers


def guest_id() -> str | None:
    gid = request.cookies.get(GUEST_COOKIE, "")
    return gid if _GUEST_ID.match(gid) else None


def new_guest_id() -> str:
    return uuid.uuid4().hex


def profile_path(gid: str | None = None) -> str:
    """Save file for the current request (call inside a request)."""
    if is_local():
        return current_app.config["SAVE_PATH"]
    gid = gid or guest_id() or new_guest_id()
    folder = os.path.join(os.path.dirname(current_app.config["SAVE_PATH"]), "guests")
    return os.path.join(folder, f"{gid}.json")
