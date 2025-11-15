"""Top-level package for the Verity v1 release."""

from __future__ import annotations

from .shared import create_shared_static_blueprint

__all__ = ["create_shared_static_blueprint", "__version__"]

__version__ = "1.0.0"
