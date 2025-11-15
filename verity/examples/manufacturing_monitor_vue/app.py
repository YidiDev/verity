from __future__ import annotations

from pathlib import Path
from typing import Iterable

from flask import Flask, render_template
from jinja2 import ChoiceLoader, FileSystemLoader

try:
    from verity.examples.manufacturing_monitor import app as backend
except ModuleNotFoundError:  # pragma: no cover - fallback for direct script execution
    import sys

    PROJECT_ROOT = Path(__file__).resolve().parents[3]
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))

    from verity.examples.manufacturing_monitor import app as backend

from verity.shared import create_shared_static_blueprint

CURRENT_DIR = Path(__file__).resolve().parent


def _ensure_template_loader(app: Flask, search_path: Path) -> None:
    loader = app.jinja_loader
    if loader is None:
        app.jinja_loader = FileSystemLoader(str(search_path))
        return
    if isinstance(loader, FileSystemLoader):
        paths: list[str] = list(loader.searchpath)
        if str(search_path) not in paths:
            loader.searchpath = paths + [str(search_path)]
        return
    if isinstance(loader, ChoiceLoader):
        paths: list[str] = []
        for sub in loader.loaders:
            if isinstance(sub, FileSystemLoader):
                paths.extend(sub.searchpath)
        if str(search_path) in paths:
            return
        loader.loaders.append(FileSystemLoader(str(search_path)))
        return
    app.jinja_loader = ChoiceLoader([loader, FileSystemLoader(str(search_path))])


def _copy_routes(app: Flask, *, ignore_endpoints: Iterable[str] = ("static",)) -> None:
    ignored = set(ignore_endpoints)
    for rule in backend.app.url_map.iter_rules():
        if rule.endpoint in ignored:
            continue
        if rule.rule == "/":
            continue
        if rule.endpoint.startswith("shared_static."):
            continue
        if rule.endpoint in app.view_functions:
            continue
        view_func = backend.app.view_functions[rule.endpoint]
        methods = [method for method in (rule.methods or set()) if method not in {"HEAD"}]
        if not methods:
            methods = None  # type: ignore[assignment]
        app.add_url_rule(rule.rule, endpoint=rule.endpoint, view_func=view_func, methods=methods)


def create_app() -> Flask:
    app = Flask(
        __name__,
        static_url_path="/static",
        static_folder=str(CURRENT_DIR / "static"),
        template_folder=str(CURRENT_DIR / "templates"),
    )
    app.register_blueprint(create_shared_static_blueprint())

    _ensure_template_loader(app, CURRENT_DIR / "templates")

    @app.get("/")
    def index():
        directory = backend._export_user_directory()
        return render_template("index.html", user_directory=directory)

    _copy_routes(app)
    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=True, port=5000)
