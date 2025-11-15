from __future__ import annotations

import datetime
import json
import os
import queue
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable

from flask import (
    Flask,
    Response,
    g,
    jsonify,
    render_template,
    request,
    stream_with_context,
)

CURRENT_DIR = Path(__file__).resolve().parent


SIMULATE_LONG_LOAD: bool = True


DIRECTIVE_REQUEST_HEADER = "X-Verity-Directive-Request"
DIRECTIVE_REQUEST_TOKEN = "send me directives"


DB_PATH = os.environ.get("DB_PATH", str(CURRENT_DIR / "app2.db"))
app = Flask(
    __name__,
    static_url_path="/static",
    static_folder=str(CURRENT_DIR / "static"),
    template_folder=str(CURRENT_DIR / "templates"),
)

# ---------- SSE Publisher ----------
_subs_lock = threading.Lock()


class _Subscriber(queue.Queue):
    """Queue wrapper that keeps track of which audience should receive events."""

    def __init__(self, audience: str):
        super().__init__()
        self.audience = audience


_subscribers: list[_Subscriber] = []
_audience_seq: dict[str, int] = {}


def _next_seq(audience: str) -> int:
    with _subs_lock:
        current = _audience_seq.get(audience, 0) + 1
        _audience_seq[audience] = current
        return current


def _current_seq(audience: str) -> int:
    with _subs_lock:
        return _audience_seq.get(audience, 0)


def _add_subscriber(audience: str) -> _Subscriber:
    q = _Subscriber(audience)
    with _subs_lock:
        _subscribers.append(q)
    return q


def _remove_subscriber(q: _Subscriber) -> None:
    with _subs_lock:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass


def _broadcast(payload: Dict[str, Any], *, audience: str) -> None:
    with _subs_lock:
        buckets = list(_subscribers)
    for q in buckets:
        if q.audience != audience:
            continue
        try:
            q.put_nowait(payload)
        except queue.Full:
            # In practice Queue is unbounded, but guard anyway.
            pass


def emit_directives(
    directives: Iterable[Dict[str, Any]],
    source: str | None,
    *,
    audience: str | None = None,
) -> None:
    dirs = []
    for d in directives:
        if not d:
            continue
        if "idempotency_key" not in d:
            d["idempotency_key"] = uuid.uuid4().hex
        dirs.append(d)
    if not dirs:
        return
    audience_key = audience or "global"
    seq = _next_seq(audience_key)
    now_iso = datetime.datetime.now(datetime.UTC).isoformat()
    payload = {
        "type": "directives",
        "directives": dirs,
        "source": source,
        "ts": now_iso,
        "seq": seq,
        "audience": audience_key,
        "seq_ts": now_iso,
    }
    _broadcast(payload, audience=audience_key)

# ---------- DB ----------
def get_db():
    db = getattr(g, "_db", None)
    if db is None:
        db = g._db = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_db(_):
    db = getattr(g, "_db", None)
    if db is not None:
        db.close()


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending',
  description TEXT,

  updated_at TEXT NOT NULL
);
"""


SEED = [
    ("First invoice", 12500, "pending", "This is a longer description for invoice 1."),
    ("Second invoice",  8900, "active",  "Consulting retainer."),
    ("Third invoice",   2999, "paused",  "Paused due to dispute."),
    ("Fourth invoice", 45000, "pending", "Annual plan."),
    ("Fifth invoice",   1599, "active",  "Add-on module."),
]

def init_db():
    db = get_db()
    db.executescript(SCHEMA_SQL)
    n = db.execute("SELECT COUNT(*) AS n FROM invoices").fetchone()[0]
    if n == 0:
        now = datetime.datetime.now(datetime.UTC).isoformat()
        db.executemany(
            "INSERT INTO invoices (title, amount_cents, status, description, updated_at) VALUES (?, ?, ?, ?, ?)",
            [(t,a,s,d,now) for (t,a,s,d) in SEED]
        )

        db.commit()


# ---------- Routes ----------
@app.route("/")
def index():
    if SIMULATE_LONG_LOAD:
        time.sleep(1)
    init_db()
    return render_template("index.html")


@app.get("/api/events")
def sse_events():
    client_id = request.args.get("client_id") or request.headers.get("X-Client-ID")
    if not client_id:
        client_id = f"anon-{uuid.uuid4()}"
    audience_key = request.args.get("audience") or request.headers.get("X-Directive-Audience") or "global"

    def event_stream():
        subscriber = _add_subscriber(str(audience_key))
        try:
            # Send an initial hello so client knows connection works
            hello = {
                "type": "hello",
                "client_id": client_id,
                "ts": datetime.datetime.now(datetime.UTC).isoformat(),
                "audience": str(audience_key),
                "last_seq": _current_seq(str(audience_key)),
            }
            yield f"data: {json.dumps(hello)}\n\n"

            while True:
                try:
                    payload = subscriber.get(timeout=15)
                except queue.Empty:
                    yield ": keep-alive\n\n"
                    continue

                yield f"data: {json.dumps(payload)}\n\n"
        finally:
            _remove_subscriber(subscriber)

    response = Response(stream_with_context(event_stream()), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response


def get_request_client_id() -> str | None:
    cid = request.headers.get("X-Client-ID")
    if cid:
        return str(cid)
    return None


def _client_wants_directives() -> bool:
    value = request.headers.get(DIRECTIVE_REQUEST_HEADER)
    if not value:
        return False
    return value.strip().lower() == DIRECTIVE_REQUEST_TOKEN.lower()


def _with_optional_directives(payload: dict[str, Any], directives: Iterable[Dict[str, Any]] | None) -> dict[str, Any]:
    if directives is None or not _client_wants_directives():
        return payload
    enriched = dict(payload)
    enriched["directives"] = list(directives)
    return enriched

# Collection: GET /api/invoices -> { ids, count }
@app.get("/api/invoices")
def list_invoices():
    if SIMULATE_LONG_LOAD:
        time.sleep(1)
    db = get_db()
    args = request.args or {}
    where, params = [], []

    status = args.get("status")
    if status:
        status_norm = str(status).lower().strip()
        if status_norm in {"pending", "active", "paused"}:
            where.append("status = ?")
            params.append(status_norm)

    search = args.get("q") or args.get("search")
    if search:
        needle = f"%{search.lower().strip()}%"
        where.append("(LOWER(title) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ?)")
        params.extend([needle, needle])

    sort = (args.get("sort") or "updated_at").lower().strip()
    sort_map = {
        "updated_at": "updated_at",
        "amount_cents": "amount_cents",
        "title": "title COLLATE NOCASE",
    }
    order_field = sort_map.get(sort, "updated_at")

    direction = (args.get("direction") or "desc").lower().strip()
    order_dir = "ASC" if direction == "asc" else "DESC"

    where_sql = ""
    if where:
        where_sql = " WHERE " + " AND ".join(where)

    query = f"SELECT id FROM invoices{where_sql} ORDER BY {order_field} {order_dir}, id DESC"
    rows = db.execute(query, tuple(params)).fetchall()
    ids = [r["id"] for r in rows]
    return jsonify({"ids": ids, "count": len(ids)})

# Single item: GET /api/invoice/<id>?level=simplified|expanded|default
@app.get("/api/invoice/<int:item_id>")
def get_invoice(item_id: int):
    if SIMULATE_LONG_LOAD:
        time.sleep(1)
    level = (request.args.get("level") or "simplified").lower()
    db = get_db()
    row = db.execute("SELECT * FROM invoices WHERE id = ?", (item_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404

    base = {
        "id": row["id"],
        "title": row["title"],
        "amount_cents": row["amount_cents"],
        "status": row["status"],
        "updated_at": row["updated_at"],
    }
    if level in ("expanded",):
        base["description"] = row["description"]
    return jsonify(base)


# Bulk: POST /api/invoices/bulk?level=simplified|expanded { ids } -> [items]
@app.post("/api/invoices/bulk")
def bulk_invoices():
    if SIMULATE_LONG_LOAD:
        time.sleep(1)
    level = (request.args.get("level") or "simplified").lower().strip()
    payload = request.get_json(force=True, silent=True) or {}
    raw_ids = payload.get("ids", [])
    if not raw_ids:
        return jsonify([])

    ids: list[int] = []
    for value in raw_ids:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue

    if not ids:
        return jsonify([])

    placeholders = ",".join(["?"] * len(ids))
    db = get_db()
    rows = db.execute(f"SELECT * FROM invoices WHERE id IN ({placeholders})", tuple(ids)).fetchall()

    results: list[dict[str, Any]] = []
    for row in rows:
        base = {
            "id": row["id"],
            "title": row["title"],
            "amount_cents": row["amount_cents"],
            "status": row["status"],
            "updated_at": row["updated_at"],
        }
        if level in ("expanded",):
            base["description"] = row["description"]
        results.append(base)

    order = {}
    for index, raw_id in enumerate(ids):
        if raw_id not in order:
            order[raw_id] = index

    results.sort(key=lambda item: order.get(item["id"], len(ids)))
    return jsonify(results)


# Mutations -> directives
@app.post("/api/invoice")
def create_invoice():
    if SIMULATE_LONG_LOAD:
        time.sleep(1)
    p = request.get_json(force=True, silent=True) or {}
    title = p.get("title", "Untitled")

    amount_cents = int(p.get("amount_cents", 0))
    desc = p.get("description", "")
    now = datetime.datetime.now(datetime.UTC).isoformat()
    db = get_db()
    db.execute(
        "INSERT INTO invoices (title, amount_cents, status, description, updated_at) VALUES (?, ?, 'pending', ?, ?)",
        (title, amount_cents, desc, now)
    )
    db.commit()
    directives = [
        {"op": "refresh_collection", "name": "invoices"}
    ]
    emit_directives(directives, get_request_client_id(), audience="global")
    response_payload = _with_optional_directives({"ok": True}, directives)
    return jsonify(response_payload)


@app.put("/api/invoice/<int:item_id>")
def update_invoice(item_id: int):
    if SIMULATE_LONG_LOAD:
        time.sleep(1)
    p = request.get_json(force=True, silent=True) or {}

    fields, params = [], []
    for k in ("title", "status", "amount_cents", "description"):
        if k in p:
            fields.append(f"{k} = ?")
            params.append(p[k])
    if not fields:
        response_payload = _with_optional_directives({"ok": True}, [])
        return jsonify(response_payload)

    now_iso = datetime.datetime.now(datetime.UTC).isoformat()
    db = get_db()
    current_row = db.execute("SELECT * FROM invoices WHERE id = ?", (item_id,)).fetchone()
    if not current_row:
        return jsonify({"error": "Not found"}), 404

    previous_status = current_row["status"]

    params.append(now_iso)
    params.append(item_id)
    db.execute(
        f"UPDATE invoices SET {', '.join(fields)}, updated_at = ? WHERE id = ?",
        tuple(params),
    )
    db.commit()
    row = db.execute("SELECT * FROM invoices WHERE id = ?", (item_id,)).fetchone()
    directive_payload: Dict[str, Any] = {"op": "refresh_item", "name": "invoice", "id": item_id}
    if row:
        simplified = {
            "id": row["id"],
            "title": row["title"],
            "amount_cents": row["amount_cents"],
            "status": row["status"],
            "updated_at": row["updated_at"],
        }
        expanded = {**simplified, "description": row["description"]}
        directive_payload["result"] = {
            "ts": now_iso,
            "levels": {
                "simplified": simplified,
                "expanded": expanded,
            },
        }
    directives = [
        directive_payload
    ]

    refresh_directives = [
        {"op": "refresh_collection", "name": "invoices"}
    ]

    if row and row["status"] != previous_status:
        if previous_status:
            refresh_directives.append(
                {
                    "op": "refresh_collection",
                    "name": "invoices",
                    "params": {"status": previous_status},
                    "params_mode": "contains",
                }
            )
        if row["status"]:
            refresh_directives.append(
                {
                    "op": "refresh_collection",
                    "name": "invoices",
                    "params": {"status": row["status"]},
                    "params_mode": "contains",
                }
            )

    directives.extend(refresh_directives)

    unique_directives: list[Dict[str, Any]] = []
    seen: set[str] = set()
    for directive in directives:
        key = json.dumps(directive, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        unique_directives.append(directive)

    emit_directives(unique_directives, get_request_client_id(), audience="global")
    response_payload = _with_optional_directives({"ok": True}, unique_directives)
    return jsonify(response_payload)


@app.delete("/api/invoice/<int:item_id>")
def delete_invoice(item_id: int):
    if SIMULATE_LONG_LOAD:
        time.sleep(1)
    db = get_db()
    db.execute("DELETE FROM invoices WHERE id = ?", (item_id,))
    db.commit()
    directives = [
        {"op": "refresh_collection", "name": "invoices"}
    ]
    emit_directives(directives, get_request_client_id(), audience="global")
    response_payload = _with_optional_directives({"ok": True}, directives)
    return jsonify(response_payload)

if __name__ == "__main__":
    app.run(debug=True, port=5000)

