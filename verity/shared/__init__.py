"""Shared infrastructure for the Verity data layer examples."""

from __future__ import annotations

from pathlib import Path
from flask import Blueprint


def create_shared_static_blueprint(url_prefix: str = "/shared") -> Blueprint:
    """Return a Flask blueprint that serves the shared static assets.

    Parameters
    ----------
    url_prefix:
        The base URL path where shared static assets should be served. This
        allows each example application to mount the shared assets under a
        consistent route, while keeping the assets themselves centralized.
    """
    base_path = Path(__file__).resolve().parent
    static_folder = base_path / "static"
    return Blueprint(
        "verity_shared_static",
        __name__,
        static_folder=str(static_folder),
        static_url_path=url_prefix,
    )


__all__ = ["create_shared_static_blueprint"]
