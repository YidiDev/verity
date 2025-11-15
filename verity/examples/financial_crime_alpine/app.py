from __future__ import annotations

import datetime
import json
import os
import queue
import sqlite3
import sys
import threading
import uuid
from collections import Counter, defaultdict
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
REPO_ROOT = CURRENT_DIR.parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from verity.shared import create_shared_static_blueprint

DIRECTIVE_REQUEST_HEADER = "X-Verity-Directive-Request"
DIRECTIVE_REQUEST_TOKEN = "send me directives"

DB_PATH = os.environ.get("FINCRIME_DB_PATH", str(CURRENT_DIR / "cases.db"))
app = Flask(
    __name__,
    static_url_path="/static",
    static_folder=str(CURRENT_DIR / "static"),
    template_folder=str(CURRENT_DIR / "templates"),
)

app.register_blueprint(create_shared_static_blueprint())

CURRENT_ANALYST = os.environ.get("FINCRIME_ACTIVE_ANALYST", "jordan.lee")
GLOBAL_ITEM_ID = "global"
SUMMARY_ITEM_ID = GLOBAL_ITEM_ID
FILINGS_ITEM_ID = GLOBAL_ITEM_ID
WATCHLIST_ITEM_ID = GLOBAL_ITEM_ID
INSIGHTS_ITEM_ID = GLOBAL_ITEM_ID

TEAM_ROSTER: list[dict[str, Any]] = [
    {
        "id": "amanda.chen",
        "name": "Amanda Chen",
        "title": "Senior Investigator",
        "region": "NA",
        "email": "amanda.chen@verity.example",
    },
    {
        "id": "marco.diaz",
        "name": "Marco Díaz",
        "title": "Investigations Lead",
        "region": "APAC",
        "email": "marco.diaz@verity.example",
    },
    {
        "id": "lena.mirza",
        "name": "Lena Mirza",
        "title": "SAR Program Manager",
        "region": "NA",
        "email": "lena.mirza@verity.example",
    },
    {
        "id": "anton.bauer",
        "name": "Anton Bauer",
        "title": "EMEA Quality Assurance",
        "region": "EMEA",
        "email": "anton.bauer@verity.example",
    },
    {
        "id": "sofia.pereira",
        "name": "Sofia Pereira",
        "title": "LATAM Intelligence Analyst",
        "region": "LATAM",
        "email": "sofia.pereira@verity.example",
    },
    {
        "id": "jordan.lee",
        "name": "Jordan Lee",
        "title": "Financial Crimes Duty Officer",
        "region": "NA",
        "email": "jordan.lee@verity.example",
    },
]

TEAM_INDEX: dict[str, dict[str, Any]] = {member["id"]: member for member in TEAM_ROSTER}

REGION_LABELS = {
    "NA": "North America",
    "EMEA": "EMEA",
    "APAC": "APAC",
    "LATAM": "LATAM",
}

# ---------- SSE Publisher ----------
_subs_lock = threading.Lock()


class _Subscriber(queue.Queue):
    """Queue wrapper that keeps track of which audience should receive events."""

    def __init__(self, audience: str):
        super().__init__()
        self.audience = audience


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
            pass


def emit_directives(
    directives: Iterable[Dict[str, Any]],
    source: str | None,
    *,
    audience: str | None = None,
) -> None:
    dirs: list[Dict[str, Any]] = []
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


_subscribers: list[_Subscriber] = []
_audience_seq: dict[str, int] = {}

# ---------- DB helpers ----------


def get_db():
    db = getattr(g, "_db", None)
    if db is None:
        db = g._db = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
    return db


@app.teardown_appcontext
def close_db(_):
    db = getattr(g, "_db", None)
    if db is not None:
        db.close()


CASE_STATUSES = [
    "triage",
    "needs_review",
    "awaiting_docs",
    "ready_for_sar",
    "sar_filed",
    "closed",
]

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "triage": {"needs_review", "awaiting_docs"},
    "needs_review": {"awaiting_docs", "ready_for_sar"},
    "awaiting_docs": {"needs_review", "ready_for_sar"},
    "ready_for_sar": {"sar_filed"},
    "sar_filed": {"closed"},
    "closed": set(),
}

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  region TEXT NOT NULL,
  risk_score INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'triage',
  summary TEXT,
  assigned_to TEXT,
  sar_due_date TEXT,
  last_transition_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'analyst_note',
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS case_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS case_watchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  watcher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(case_id, watcher),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);
"""

SEED_DATA = [
    {
        "account_number": "ACCT-14022",
        "customer_name": "Northwind Export Ltd.",
        "region": "NA",
        "risk_score": 72,
        "status": "needs_review",
        "summary": "Nested shell entities obscured trade flows; correspondent bank confirms layered wires over 72 hours.",
        "assigned_to": "amanda.chen",
        "sar_due_date_offset_days": 7,
        "created_days_ago": 6,
    },
    {
        "account_number": "ACCT-99300",
        "customer_name": "Emerald Holdings",
        "region": "EMEA",
        "risk_score": 88,
        "status": "awaiting_docs",
        "summary": "Negative media on beneficial owner; pending notarised invoices translated from Romanian counsel.",
        "assigned_to": None,
        "sar_due_date_offset_days": 4,
        "created_days_ago": 9,
    },
    {
        "account_number": "ACCT-55211",
        "customer_name": "Pacific Commodities",
        "region": "APAC",
        "risk_score": 64,
        "status": "triage",
        "summary": "Escalated from sanctions queue after exact-match hit to SDN — awaiting ownership attestation.",
        "assigned_to": "marco.diaz",
        "sar_due_date_offset_days": 10,
        "created_days_ago": 2,
    },
    {
        "account_number": "ACCT-77890",
        "customer_name": "Helios Crypto OTC",
        "region": "NA",
        "risk_score": 95,
        "status": "ready_for_sar",
        "summary": "Structuring across 14 wallets; blockchain analytics vendor confirmed mixer exposure exceeding policy threshold.",
        "assigned_to": "lena.mirza",
        "sar_due_date_offset_days": 2,
        "created_days_ago": 12,
    },
    {
        "account_number": "ACCT-44107",
        "customer_name": "Silverline Charters",
        "region": "LATAM",
        "risk_score": 58,
        "status": "sar_filed",
        "summary": "SAR filed with FinCEN; pending regulator acknowledgement and remediation checklist closure.",
        "assigned_to": None,
        "sar_due_date_offset_days": -2,
        "created_days_ago": 21,
    },
    {
        "account_number": "ACCT-33882",
        "customer_name": "Aurora Trade Finance",
        "region": "EMEA",
        "risk_score": 47,
        "status": "closed",
        "summary": "Alert closed after relationship manager supplied authentic bills of lading; QA completed review.",
        "assigned_to": "anton.bauer",
        "sar_due_date_offset_days": -12,
        "created_days_ago": 28,
    },
]

SEED_NOTES = [
    {
        "account_number": "ACCT-14022",
        "author": "amanda.chen",
        "body": "Reached correspondent bank compliance team; walkthrough of invoice trail scheduled for tomorrow.",
        "category": "analyst_note",
        "days_ago": 2,
    },
    {
        "account_number": "ACCT-14022",
        "author": "lena.mirza",
        "body": "SAR committee flagged need for refreshed KYC package prior to escalation.",
        "category": "escalation",
        "days_ago": 1,
    },
    {
        "account_number": "ACCT-99300",
        "author": "anton.bauer",
        "body": "Coordinating translation vendor; ETA for invoices is end of week.",
        "category": "analyst_note",
        "days_ago": 3,
    },
    {
        "account_number": "ACCT-77890",
        "author": "lena.mirza",
        "body": "Draft SAR narrative capturing structuring pattern submitted for QA.",
        "category": "analyst_note",
        "days_ago": 1,
    },
    {
        "account_number": "ACCT-55211",
        "author": "marco.diaz",
        "body": "Sanctions vendor confirmed positive hit; awaiting customer attestation from RM.",
        "category": "analyst_note",
        "days_ago": 1,
    },
]

SEED_TRANSITIONS = [
    {
        "account_number": "ACCT-14022",
        "from_status": "triage",
        "to_status": "needs_review",
        "actor": "amanda.chen",
        "note": "Documentation validated, moving to full review.",
        "days_ago": 5,
    },
    {
        "account_number": "ACCT-99300",
        "from_status": "triage",
        "to_status": "needs_review",
        "actor": "anton.bauer",
        "note": "Adverse media confirmed, escalate for document request.",
        "days_ago": 7,
    },
    {
        "account_number": "ACCT-99300",
        "from_status": "needs_review",
        "to_status": "awaiting_docs",
        "actor": "anton.bauer",
        "note": "Holding until notarised invoices arrive.",
        "days_ago": 4,
    },
    {
        "account_number": "ACCT-77890",
        "from_status": "needs_review",
        "to_status": "awaiting_docs",
        "actor": "lena.mirza",
        "note": "Requested blockchain vendor workbook.",
        "days_ago": 10,
    },
    {
        "account_number": "ACCT-77890",
        "from_status": "awaiting_docs",
        "to_status": "ready_for_sar",
        "actor": "lena.mirza",
        "note": "Risk appetite exceeded; prepping SAR.",
        "days_ago": 3,
    },
    {
        "account_number": "ACCT-44107",
        "from_status": "ready_for_sar",
        "to_status": "sar_filed",
        "actor": "sofia.pereira",
        "note": "Filed SAR with regulator, retaining courier receipt.",
        "days_ago": 6,
    },
    {
        "account_number": "ACCT-44107",
        "from_status": "sar_filed",
        "to_status": "closed",
        "actor": "sofia.pereira",
        "note": "Regulator acknowledged receipt and QA cleared residual tasks.",
        "days_ago": 3,
    },
]

SEED_WATCHERS = [
    {"account_number": "ACCT-14022", "watcher": "lena.mirza", "days_ago": 5},
    {"account_number": "ACCT-14022", "watcher": "jordan.lee", "days_ago": 1},
    {"account_number": "ACCT-99300", "watcher": "anton.bauer", "days_ago": 4},
    {"account_number": "ACCT-77890", "watcher": "lena.mirza", "days_ago": 8},
    {"account_number": "ACCT-55211", "watcher": "marco.diaz", "days_ago": 1},
]


def _resolve_roster_identity(identifier: str | None) -> dict[str, Any]:
    if not identifier:
        return {
            "id": None,
            "name": "Unassigned",
            "title": None,
            "region": None,
            "email": None,
        }
    key = str(identifier)
    member = TEAM_INDEX.get(key)
    if member:
        return {
            "id": member["id"],
            "name": member.get("name"),
            "title": member.get("title"),
            "region": member.get("region"),
            "email": member.get("email"),
        }
    parts = key.replace("_", " ").replace(".", " ").split()
    fallback_name = " ".join(part.capitalize() for part in parts) if parts else key
    return {
        "id": key,
        "name": fallback_name,
        "title": None,
        "region": None,
        "email": None,
    }


def _serialize_watcher_row(row: sqlite3.Row) -> dict[str, Any]:
    identity = _resolve_roster_identity(row["watcher"])
    return {
        **identity,
        "since": row["created_at"],
    }


def _fetch_watchers(db: sqlite3.Connection, case_id: int) -> list[dict[str, Any]]:
    watcher_rows = db.execute(
        "SELECT watcher, created_at FROM case_watchers WHERE case_id = ? ORDER BY created_at ASC",
        (case_id,),
    ).fetchall()
    return [_serialize_watcher_row(row) for row in watcher_rows]


def _build_timeline_events(db: sqlite3.Connection, case_id: int) -> list[dict[str, Any]]:
    transition_rows = db.execute(
        """
        SELECT id, from_status, to_status, note, actor, created_at
        FROM case_transitions
        WHERE case_id = ?
        ORDER BY created_at DESC, id DESC
        """,
        (case_id,),
    ).fetchall()
    note_rows = db.execute(
        """
        SELECT id, author, body, category, created_at
        FROM case_notes
        WHERE case_id = ?
        ORDER BY created_at DESC, id DESC
        """,
        (case_id,),
    ).fetchall()

    events: list[dict[str, Any]] = []
    for row in transition_rows:
        events.append(
            {
                "id": f"transition-{row['id']}",
                "type": "transition",
                "from_status": row["from_status"],
                "to_status": row["to_status"],
                "note": row["note"],
                "actor": _resolve_roster_identity(row["actor"]),
                "created_at": row["created_at"],
            }
        )
    for row in note_rows:
        events.append(
            {
                "id": f"note-{row['id']}",
                "type": "note",
                "category": row["category"],
                "body": row["body"],
                "author": _resolve_roster_identity(row["author"]),
                "created_at": row["created_at"],
            }
        )

    events.sort(key=lambda event: event.get("created_at") or "", reverse=True)
    return events


def init_db():
    db = get_db()
    db.executescript(SCHEMA_SQL)
    count = db.execute("SELECT COUNT(*) AS n FROM cases").fetchone()[0]
    if count == 0:
        now = datetime.datetime.now(datetime.UTC)

        def ts_from_offsets(days: int | float | None = None, hours: int | float | None = None) -> str:
            delta = datetime.timedelta(days=days or 0, hours=hours or 0)
            return (now - delta).isoformat()

        case_lookup: dict[str, int] = {}
        latest_updates: dict[int, str] = {}
        last_transition_notes: dict[int, str | None] = {}

        for item in SEED_DATA:
            created_at = ts_from_offsets(days=item.get("created_days_ago"))
            updated_at = created_at
            sar_due_date: str | None = None
            if "sar_due_date_offset_days" in item and item["sar_due_date_offset_days"] is not None:
                sar_due_date = (now + datetime.timedelta(days=item["sar_due_date_offset_days"])).isoformat()

            cursor = db.execute(
                """
                INSERT INTO cases (account_number, customer_name, region, risk_score, status, summary, assigned_to, sar_due_date, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["account_number"],
                    item["customer_name"],
                    item["region"],
                    item["risk_score"],
                    item["status"],
                    item["summary"],
                    item.get("assigned_to"),
                    sar_due_date,
                    created_at,
                    updated_at,
                ),
            )
            case_id = cursor.lastrowid
            case_lookup[item["account_number"]] = case_id
            latest_updates[case_id] = updated_at

        for entry in SEED_TRANSITIONS:
            case_id = case_lookup.get(entry["account_number"])
            if not case_id:
                continue
            created_at = ts_from_offsets(days=entry.get("days_ago"), hours=entry.get("hours_ago"))
            db.execute(
                """
                INSERT INTO case_transitions (case_id, from_status, to_status, note, actor, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    case_id,
                    entry["from_status"],
                    entry["to_status"],
                    entry.get("note"),
                    entry.get("actor") or "system",
                    created_at,
                ),
            )
            latest_updates[case_id] = max(latest_updates.get(case_id, created_at), created_at)
            last_transition_notes[case_id] = entry.get("note") or last_transition_notes.get(case_id)

        for entry in SEED_NOTES:
            case_id = case_lookup.get(entry["account_number"])
            if not case_id:
                continue
            created_at = ts_from_offsets(days=entry.get("days_ago"), hours=entry.get("hours_ago"))
            db.execute(
                """
                INSERT INTO case_notes (case_id, author, body, category, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    case_id,
                    entry.get("author") or "system",
                    entry.get("body") or "",
                    entry.get("category") or "analyst_note",
                    created_at,
                ),
            )
            latest_updates[case_id] = max(latest_updates.get(case_id, created_at), created_at)

        for entry in SEED_WATCHERS:
            case_id = case_lookup.get(entry["account_number"])
            if not case_id:
                continue
            created_at = ts_from_offsets(days=entry.get("days_ago"), hours=entry.get("hours_ago"))
            try:
                db.execute(
                    """
                    INSERT OR IGNORE INTO case_watchers (case_id, watcher, created_at)
                    VALUES (?, ?, ?)
                    """,
                    (case_id, entry.get("watcher"), created_at),
                )
            except sqlite3.DatabaseError:
                continue

        for account_number, case_id in case_lookup.items():
            updated_at = latest_updates.get(case_id)
            last_note = last_transition_notes.get(case_id)
            if updated_at or last_note:
                db.execute(
                    "UPDATE cases SET updated_at = COALESCE(?, updated_at), last_transition_note = COALESCE(?, last_transition_note) WHERE id = ?",
                    (updated_at, last_note, case_id),
                )

        db.commit()


# ---------- Routes ----------


@app.route("/")
def index():
    init_db()
    return render_template("index.html", current_user=CURRENT_ANALYST)


@app.get("/api/events")
def sse_events():
    client_id = request.args.get("client_id") or request.headers.get("X-Client-ID")
    if not client_id:
        client_id = f"anon-{uuid.uuid4()}"
    audience_key = request.args.get("audience") or request.headers.get("X-Directive-Audience") or "global"

    def event_stream():
        subscriber = _add_subscriber(str(audience_key))
        try:
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


def get_request_actor() -> str | None:
    actor = request.headers.get("X-Acting-User")
    if actor:
        return str(actor)
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


def _compute_dashboard_summary(
    db: sqlite3.Connection,
    *,
    now: datetime.datetime | None = None,
) -> dict[str, Any]:
    reference = now or datetime.datetime.now(datetime.UTC)

    status_rows = db.execute("SELECT status, COUNT(*) AS c FROM cases GROUP BY status").fetchall()
    status_counts = {status: 0 for status in CASE_STATUSES}
    for row in status_rows:
        status_counts[row["status"]] = row["c"]

    total_cases = sum(status_counts.values())
    open_statuses = {s for s in CASE_STATUSES if s != "closed"}
    open_cases = sum(status_counts.get(s, 0) for s in open_statuses)

    horizon = (reference + datetime.timedelta(days=3)).isoformat()
    now_iso = reference.isoformat()

    due_soon = db.execute(
        """
        SELECT COUNT(*) FROM cases
        WHERE sar_due_date IS NOT NULL AND status != 'closed' AND sar_due_date <= ?
        """,
        (horizon,),
    ).fetchone()[0]
    overdue = db.execute(
        """
        SELECT COUNT(*) FROM cases
        WHERE sar_due_date IS NOT NULL AND status != 'closed' AND sar_due_date < ?
        """,
        (now_iso,),
    ).fetchone()[0]
    unassigned = db.execute(
        """
        SELECT COUNT(*) FROM cases
        WHERE (assigned_to IS NULL OR assigned_to = '') AND status != 'closed'
        """,
    ).fetchone()[0]

    region_rows = db.execute("SELECT region, COUNT(*) AS c FROM cases GROUP BY region").fetchall()
    region_breakdown = [
        {
            "region": row["region"],
            "label": REGION_LABELS.get(row["region"], row["region"]),
            "count": row["c"],
        }
        for row in region_rows
    ]

    transitions_24h = db.execute(
        "SELECT COUNT(*) FROM case_transitions WHERE created_at >= ?",
        ((reference - datetime.timedelta(hours=24)).isoformat(),),
    ).fetchone()[0]
    notes_24h = db.execute(
        "SELECT COUNT(*) FROM case_notes WHERE created_at >= ?",
        ((reference - datetime.timedelta(hours=24)).isoformat(),),
    ).fetchone()[0]
    aging_backlog = db.execute(
        """
        SELECT COUNT(*) FROM cases
        WHERE status IN ('needs_review', 'awaiting_docs') AND created_at <= ?
        """,
        ((reference - datetime.timedelta(days=7)).isoformat(),),
    ).fetchone()[0]
    active_watchers = db.execute(
        "SELECT COUNT(*) FROM case_watchers",
    ).fetchone()[0]

    return {
        "status_counts": status_counts,
        "total": total_cases,
        "open_cases": open_cases,
        "due_soon": due_soon,
        "overdue": overdue,
        "unassigned": unassigned,
        "region_breakdown": region_breakdown,
        "transitions_last_24h": transitions_24h,
        "notes_last_24h": notes_24h,
        "aging_backlog": aging_backlog,
        "active_watchers": active_watchers,
        "last_generated": now_iso,
    }


def _summary_refresh_directive(
    db: sqlite3.Connection,
    *,
    now: datetime.datetime | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = payload or _compute_dashboard_summary(db, now=now)
    ts = data.get("last_generated")
    if ts is None and now is not None:
        ts = now.isoformat()
    elif ts is None:
        ts = datetime.datetime.now(datetime.UTC).isoformat()
    return {
        "op": "refresh_item",
        "name": "dashboardSummary",
        "id": SUMMARY_ITEM_ID,
        "result": {
            "data": data,
            "ts": ts,
        },
    }


def _parse_iso_datetime(value: str | None) -> datetime.datetime | None:
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def _compute_filing_schedule(
    db: sqlite3.Connection,
    *,
    now: datetime.datetime | None = None,
) -> dict[str, Any]:
    reference = now or datetime.datetime.now(datetime.UTC)
    reference_date = reference.date()

    watcher_counts = {
        row["case_id"]: row["watchers"]
        for row in db.execute(
            "SELECT case_id, COUNT(*) AS watchers FROM case_watchers GROUP BY case_id"
        ).fetchall()
    }

    rows = db.execute(
        """
        SELECT id, account_number, customer_name, region, risk_score, status,
               summary, assigned_to, sar_due_date, updated_at, last_transition_note
        FROM cases
        WHERE sar_due_date IS NOT NULL
        ORDER BY sar_due_date ASC, id ASC
        """
    ).fetchall()

    open_with_due = 0
    due_today = 0
    due_week = 0
    overdue = 0
    upcoming: list[dict[str, Any]] = []
    week_buckets: dict[str, dict[str, Any]] = {}

    for row in rows:
        due_dt = _parse_iso_datetime(row["sar_due_date"])
        if not due_dt:
            continue
        due_date = due_dt.date()
        days_out = (due_date - reference_date).days
        is_overdue = due_date < reference_date
        if row["status"] != "closed":
            open_with_due += 1
            if is_overdue:
                overdue += 1
            if due_date == reference_date:
                due_today += 1
            if not is_overdue and days_out <= 7:
                due_week += 1

        week_start = (due_dt - datetime.timedelta(days=due_dt.weekday())).date()
        week_key = week_start.isoformat()
        bucket = week_buckets.setdefault(
            week_key,
            {
                "week_start": week_key,
                "week_end": (week_start + datetime.timedelta(days=6)).isoformat(),
                "count": 0,
                "status_counts": {status: 0 for status in CASE_STATUSES},
            },
        )
        bucket["count"] += 1
        bucket["status_counts"][row["status"]] = bucket["status_counts"].get(row["status"], 0) + 1

        upcoming.append(
            {
                "case_id": row["id"],
                "account_number": row["account_number"],
                "customer_name": row["customer_name"],
                "summary": row["summary"],
                "status": row["status"],
                "region": row["region"],
                "risk_score": row["risk_score"],
                "sar_due_date": due_dt.isoformat(),
                "due_in_days": days_out,
                "is_overdue": is_overdue,
                "assigned_to": _resolve_roster_identity(row["assigned_to"]),
                "watchers": watcher_counts.get(row["id"], 0),
                "last_transition_note": row["last_transition_note"],
                "updated_at": row["updated_at"],
            }
        )

    upcoming.sort(key=lambda item: (item["sar_due_date"], item["case_id"]))
    upcoming = upcoming[:50]

    calendar = [week_buckets[key] for key in sorted(week_buckets.keys())]

    without_due = db.execute(
        "SELECT COUNT(*) FROM cases WHERE sar_due_date IS NULL AND status != 'closed'"
    ).fetchone()[0]

    filings_last_week = db.execute(
        """
        SELECT COUNT(*) FROM case_transitions
        WHERE to_status = 'sar_filed' AND created_at >= ?
        """,
        ((reference - datetime.timedelta(days=7)).isoformat(),),
    ).fetchone()[0]

    recent_filings_rows = db.execute(
        """
        SELECT t.case_id, t.note, t.actor, t.created_at,
               c.account_number, c.customer_name, c.region, c.risk_score
        FROM case_transitions t
        JOIN cases c ON c.id = t.case_id
        WHERE t.to_status = 'sar_filed'
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 10
        """
    ).fetchall()

    recent_filings = [
        {
            "case_id": row["case_id"],
            "account_number": row["account_number"],
            "customer_name": row["customer_name"],
            "note": row["note"],
            "actor": _resolve_roster_identity(row["actor"]),
            "created_at": row["created_at"],
            "region": row["region"],
            "risk_score": row["risk_score"],
        }
        for row in recent_filings_rows
    ]

    return {
        "generated_at": reference.isoformat(),
        "summary": {
            "open_with_due": open_with_due,
            "overdue": overdue,
            "due_today": due_today,
            "due_week": due_week,
            "without_due": without_due,
            "filed_last_week": filings_last_week,
        },
        "upcoming": upcoming,
        "calendar": calendar,
        "recent_filings": recent_filings,
    }


def _filing_schedule_directive(
    db: sqlite3.Connection,
    *,
    now: datetime.datetime | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = payload or _compute_filing_schedule(db, now=now)
    return {
        "op": "refresh_item",
        "name": "filingSchedule",
        "id": FILINGS_ITEM_ID,
        "result": {
            "data": data,
            "ts": data.get("generated_at"),
        },
    }


def _compute_watchlist_overview(
    db: sqlite3.Connection,
    *,
    now: datetime.datetime | None = None,
) -> dict[str, Any]:
    reference = now or datetime.datetime.now(datetime.UTC)
    reference_date = reference.date()

    watcher_rows = db.execute(
        """
        SELECT cw.watcher, cw.created_at AS linked_at, cw.case_id,
               c.account_number, c.customer_name, c.summary, c.status,
               c.region, c.risk_score, c.assigned_to, c.sar_due_date, c.updated_at
        FROM case_watchers cw
        JOIN cases c ON c.id = cw.case_id
        ORDER BY cw.created_at DESC
        """
    ).fetchall()

    watchers: dict[str, dict[str, Any]] = {}
    total_links = 0
    for row in watcher_rows:
        total_links += 1
        watcher_id = row["watcher"]
        identity = _resolve_roster_identity(watcher_id)
        entry = watchers.setdefault(
            watcher_id,
            {
                "id": identity.get("id") or watcher_id,
                "name": identity.get("name") or watcher_id,
                "title": identity.get("title"),
                "region": identity.get("region"),
                "email": identity.get("email"),
                "cases": [],
                "open_cases": 0,
                "total_cases": 0,
                "regions": set(),
                "last_activity": None,
            },
        )

        due_dt = _parse_iso_datetime(row["sar_due_date"])
        due_date = due_dt.date() if due_dt else None
        due_in_days = (due_date - reference_date).days if due_date else None
        is_overdue = bool(due_date and due_date < reference_date)

        case_payload = {
            "case_id": row["case_id"],
            "account_number": row["account_number"],
            "customer_name": row["customer_name"],
            "status": row["status"],
            "region": row["region"],
            "risk_score": row["risk_score"],
            "sar_due_date": row["sar_due_date"],
            "due_in_days": due_in_days,
            "is_overdue": is_overdue,
            "assigned_to": _resolve_roster_identity(row["assigned_to"]),
            "summary": row["summary"],
            "watching_since": row["linked_at"],
            "updated_at": row["updated_at"],
        }

        entry["cases"].append(case_payload)
        entry["total_cases"] += 1
        if row["status"] != "closed":
            entry["open_cases"] += 1
        entry["regions"].add(row["region"])

        updated_ts = _parse_iso_datetime(row["updated_at"]) or _parse_iso_datetime(
            row["linked_at"]
        )
        if updated_ts and (
            entry["last_activity"] is None or updated_ts > entry["last_activity"]
        ):
            entry["last_activity"] = updated_ts

    watchers_list: list[dict[str, Any]] = []
    for watcher in watchers.values():
        watcher["regions"] = [REGION_LABELS.get(code, code) for code in sorted(watcher["regions"])]
        watcher["cases"].sort(
            key=lambda case: (
                0 if case["is_overdue"] else 1,
                case["due_in_days"] if case["due_in_days"] is not None else 9999,
                -case["risk_score"],
            )
        )
        if watcher["last_activity"]:
            watcher["last_activity"] = watcher["last_activity"].isoformat()
        watchers_list.append(watcher)

    watchers_list.sort(
        key=lambda entry: (
            -entry["open_cases"],
            -entry["total_cases"],
            entry["name"].lower(),
        )
    )

    cases_with_watchers = db.execute(
        "SELECT COUNT(DISTINCT case_id) FROM case_watchers"
    ).fetchone()[0]
    open_cases = db.execute(
        "SELECT COUNT(*) FROM cases WHERE status != 'closed'"
    ).fetchone()[0]

    unwatched_rows = db.execute(
        """
        SELECT id, account_number, customer_name, region, risk_score, status,
               sar_due_date, summary, assigned_to, updated_at
        FROM cases
        WHERE id NOT IN (SELECT DISTINCT case_id FROM case_watchers)
          AND status != 'closed'
        ORDER BY risk_score DESC,
                 (sar_due_date IS NULL),
                 sar_due_date ASC,
                 updated_at DESC
        LIMIT 6
        """
    ).fetchall()

    unwatched = [
        {
            "case_id": row["id"],
            "account_number": row["account_number"],
            "customer_name": row["customer_name"],
            "region": row["region"],
            "risk_score": row["risk_score"],
            "sar_due_date": row["sar_due_date"],
            "assigned_to": _resolve_roster_identity(row["assigned_to"]),
            "summary": row["summary"],
            "updated_at": row["updated_at"],
        }
        for row in unwatched_rows
    ]

    recent_links = [
        {
            "watcher": _resolve_roster_identity(row["watcher"]),
            "case_id": row["case_id"],
            "account_number": row["account_number"],
            "customer_name": row["customer_name"],
            "created_at": row["linked_at"],
            "region": row["region"],
        }
        for row in watcher_rows[:8]
    ]

    coverage = {
        "total_links": total_links,
        "unique_watchers": len(watchers_list),
        "cases_with_watchers": cases_with_watchers,
        "open_cases": open_cases,
        "average_watchers_per_case": (
            total_links / cases_with_watchers if cases_with_watchers else 0.0
        ),
        "percent_open_covered": (
            cases_with_watchers / open_cases if open_cases else 0.0
        ),
    }

    return {
        "generated_at": reference.isoformat(),
        "coverage": coverage,
        "watchers": watchers_list,
        "recent_links": recent_links,
        "unwatched": unwatched,
    }


def _watchlist_refresh_directive(
    db: sqlite3.Connection,
    *,
    now: datetime.datetime | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = payload or _compute_watchlist_overview(db, now=now)
    return {
        "op": "refresh_item",
        "name": "watchlistOverview",
        "id": WATCHLIST_ITEM_ID,
        "result": {
            "data": data,
            "ts": data.get("generated_at"),
        },
    }


def _compute_analytics_insights(
    db: sqlite3.Connection,
    *,
    now: datetime.datetime | None = None,
    summary_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    reference = now or datetime.datetime.now(datetime.UTC)
    summary = summary_payload or _compute_dashboard_summary(db, now=now)

    risk_rows = db.execute("SELECT risk_score FROM cases").fetchall()
    risk_bands = {"0_40": 0, "41_70": 0, "71_plus": 0}
    for row in risk_rows:
        score = row["risk_score"] or 0
        if score <= 40:
            risk_bands["0_40"] += 1
        elif score <= 70:
            risk_bands["41_70"] += 1
        else:
            risk_bands["71_plus"] += 1

    region_status_rows = db.execute(
        "SELECT region, status, COUNT(*) AS c FROM cases GROUP BY region, status"
    ).fetchall()
    region_status: dict[str, dict[str, int]] = defaultdict(lambda: {status: 0 for status in CASE_STATUSES})
    for row in region_status_rows:
        region_status[row["region"]][row["status"]] = row["c"]

    window_days = 14
    start_window = reference - datetime.timedelta(days=window_days - 1)
    transition_rows = db.execute(
        "SELECT to_status, created_at FROM case_transitions WHERE created_at >= ?",
        (start_window.isoformat(),),
    ).fetchall()
    transitions_by_day: dict[str, int] = defaultdict(int)
    transitions_status_by_day: dict[str, Counter] = defaultdict(Counter)
    for row in transition_rows:
        created = _parse_iso_datetime(row["created_at"])
        if not created:
            continue
        day_key = created.date().isoformat()
        transitions_by_day[day_key] += 1
        transitions_status_by_day[day_key][row["to_status"]] += 1

    transition_series: list[dict[str, Any]] = []
    for offset in range(window_days):
        day = (start_window + datetime.timedelta(days=offset)).date()
        key = day.isoformat()
        by_status = transitions_status_by_day.get(key, Counter())
        transition_series.append(
            {
                "date": key,
                "count": transitions_by_day.get(key, 0),
                "by_status": dict(by_status),
            }
        )

    note_rows = db.execute(
        "SELECT category, COUNT(*) AS c FROM case_notes WHERE created_at >= ? GROUP BY category",
        ((reference - datetime.timedelta(days=7)).isoformat(),),
    ).fetchall()
    note_counts = {row["category"]: row["c"] for row in note_rows}

    aging_rows = db.execute(
        "SELECT created_at FROM cases WHERE status != 'closed'"
    ).fetchall()
    aging_buckets = {"under_3": 0, "three_to_seven": 0, "seven_to_fourteen": 0, "over_14": 0}
    for row in aging_rows:
        created = _parse_iso_datetime(row["created_at"])
        if not created:
            continue
        age_days = (reference - created).days
        if age_days < 3:
            aging_buckets["under_3"] += 1
        elif age_days < 7:
            aging_buckets["three_to_seven"] += 1
        elif age_days < 14:
            aging_buckets["seven_to_fourteen"] += 1
        else:
            aging_buckets["over_14"] += 1

    assignment_rows = db.execute(
        """
        SELECT COALESCE(assigned_to, '') AS assignee, COUNT(*) AS c
        FROM cases
        WHERE status != 'closed'
        GROUP BY COALESCE(assigned_to, '')
        """
    ).fetchall()
    assignment_load = []
    for row in assignment_rows:
        assignee = row["assignee"] or None
        identity = _resolve_roster_identity(assignee)
        assignment_load.append(
            {
                "assignee": identity,
                "count": row["c"],
            }
        )
    assignment_load.sort(key=lambda item: -item["count"])

    top_risk_rows = db.execute(
        """
        SELECT id, account_number, customer_name, region, risk_score, status,
               sar_due_date, assigned_to, summary
        FROM cases
        WHERE status != 'closed'
        ORDER BY risk_score DESC, updated_at DESC
        LIMIT 6
        """
    ).fetchall()
    top_risk_accounts = [
        {
            "case_id": row["id"],
            "account_number": row["account_number"],
            "customer_name": row["customer_name"],
            "region": row["region"],
            "risk_score": row["risk_score"],
            "status": row["status"],
            "sar_due_date": row["sar_due_date"],
            "assigned_to": _resolve_roster_identity(row["assigned_to"]),
            "summary": row["summary"],
        }
        for row in top_risk_rows
    ]

    region_payload = [
        {
            "region": region,
            "label": REGION_LABELS.get(region, region),
            "status_counts": counts,
        }
        for region, counts in region_status.items()
    ]
    region_payload.sort(key=lambda item: item["label"].lower())

    return {
        "generated_at": reference.isoformat(),
        "summary": summary,
        "risk_bands": risk_bands,
        "region_status": region_payload,
        "transition_velocity": {
            "series": transition_series,
            "window_start": start_window.date().isoformat(),
            "window_end": reference.date().isoformat(),
        },
        "note_activity": note_counts,
        "aging_buckets": aging_buckets,
        "assignment_load": assignment_load,
        "top_risk_accounts": top_risk_accounts,
    }


def _analytics_refresh_directive(
    db: sqlite3.Connection,
    *,
    now: datetime.datetime | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = payload or _compute_analytics_insights(db, now=now)
    return {
        "op": "refresh_item",
        "name": "analyticsInsights",
        "id": INSIGHTS_ITEM_ID,
        "result": {
            "data": data,
            "ts": data.get("generated_at"),
        },
    }


def _compute_global_dashboard_payloads(
    db: sqlite3.Connection,
    *,
    now: datetime.datetime,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    summary_payload = _compute_dashboard_summary(db, now=now)
    filings_payload = _compute_filing_schedule(db, now=now)
    watchlist_payload = _compute_watchlist_overview(db, now=now)
    insights_payload = _compute_analytics_insights(
        db, now=now, summary_payload=summary_payload
    )
    return summary_payload, filings_payload, watchlist_payload, insights_payload


def _global_dashboard_directives(
    db: sqlite3.Connection,
    *,
    now: datetime.datetime,
) -> list[dict[str, Any]]:
    summary_payload, filings_payload, watchlist_payload, insights_payload = _compute_global_dashboard_payloads(
        db, now=now
    )
    return [
        _summary_refresh_directive(db, now=now, payload=summary_payload),
        _filing_schedule_directive(db, now=now, payload=filings_payload),
        _watchlist_refresh_directive(db, now=now, payload=watchlist_payload),
        _analytics_refresh_directive(db, now=now, payload=insights_payload),
    ]


@app.get("/api/cases")
def list_cases():
    db = get_db()
    args = request.args or {}

    where: list[str] = []
    params: list[Any] = []

    status = args.get("status")
    if status:
        status_norm = str(status).strip().lower()
        if status_norm in CASE_STATUSES:
            where.append("status = ?")
            params.append(status_norm)

    region = args.get("region")
    if region:
        where.append("LOWER(region) = ?")
        params.append(str(region).strip().lower())

    account = args.get("account")
    if account:
        where.append("LOWER(account_number) LIKE ?")
        params.append(f"%{str(account).strip().lower()}%")

    search = args.get("q") or args.get("search")
    if search:
        needle = f"%{str(search).strip().lower()}%"
        where.append("(LOWER(customer_name) LIKE ? OR LOWER(COALESCE(summary, '')) LIKE ? OR LOWER(account_number) LIKE ?)")
        params.extend([needle, needle, needle])

    risk_min = args.get("risk_min")
    if risk_min:
        try:
            where.append("risk_score >= ?")
            params.append(int(risk_min))
        except ValueError:
            pass

    risk_max = args.get("risk_max")
    if risk_max:
        try:
            where.append("risk_score <= ?")
            params.append(int(risk_max))
        except ValueError:
            pass

    assigned = args.get("assigned_to")
    if assigned:
        if str(assigned).strip() == "unassigned":
            where.append("(assigned_to IS NULL OR assigned_to = '')")
        else:
            where.append("LOWER(assigned_to) = ?")
            params.append(str(assigned).strip().lower())

    where_sql = ""
    if where:
        where_sql = " WHERE " + " AND ".join(where)

    sort = (args.get("sort") or "updated_at").strip().lower()
    sort_map = {
        "updated_at": "updated_at",
        "risk_score": "risk_score",
        "sar_due_date": "sar_due_date",
        "customer_name": "customer_name COLLATE NOCASE",
    }
    order_field = sort_map.get(sort, "updated_at")

    direction = (args.get("direction") or "desc").strip().lower()
    order_dir = "ASC" if direction == "asc" else "DESC"

    query = f"SELECT id FROM cases{where_sql} ORDER BY {order_field} {order_dir}, id DESC"
    rows = db.execute(query, tuple(params)).fetchall()
    ids = [row["id"] for row in rows]
    return jsonify({"ids": ids, "count": len(ids)})


@app.get("/api/case/<int:case_id>")
def get_case(case_id: int):
    level = (request.args.get("level") or "simplified").lower().strip()
    db = get_db()
    row = db.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404

    simplified = {
        "id": row["id"],
        "account_number": row["account_number"],
        "customer_name": row["customer_name"],
        "region": row["region"],
        "risk_score": row["risk_score"],
        "status": row["status"],
        "sar_due_date": row["sar_due_date"],
        "assigned_to": row["assigned_to"],
        "updated_at": row["updated_at"],
    }
    if level in ("expanded",):
        expanded = dict(simplified)
        expanded.update(
            {
                "summary": row["summary"],
                "created_at": row["created_at"],
                "last_transition_note": row["last_transition_note"],
                "watchers": _fetch_watchers(db, case_id),
                "timeline_digest": _build_timeline_events(db, case_id)[:5],
            }
        )
        return jsonify(expanded)
    return jsonify(simplified)


@app.get("/api/case/<int:case_id>/timeline")
def case_timeline(case_id: int):
    db = get_db()
    exists = db.execute("SELECT 1 FROM cases WHERE id = ?", (case_id,)).fetchone()
    if not exists:
        return jsonify({"error": "Not found"}), 404
    events = _build_timeline_events(db, case_id)
    return jsonify({"events": events})


@app.post("/api/cases/bulk")
def bulk_cases():
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
    rows = db.execute(f"SELECT * FROM cases WHERE id IN ({placeholders})", tuple(ids)).fetchall()

    results: list[dict[str, Any]] = []
    for row in rows:
        base = {
            "id": row["id"],
            "account_number": row["account_number"],
            "customer_name": row["customer_name"],
            "region": row["region"],
            "risk_score": row["risk_score"],
            "status": row["status"],
            "sar_due_date": row["sar_due_date"],
            "assigned_to": row["assigned_to"],
            "updated_at": row["updated_at"],
        }
        if level in ("expanded",):
            base.update(
                {
                    "summary": row["summary"],
                    "created_at": row["created_at"],
                    "last_transition_note": row["last_transition_note"],
                }
            )
        results.append(base)

    order: dict[int, int] = {}
    for index, raw_id in enumerate(ids):
        if raw_id not in order:
            order[raw_id] = index
    results.sort(key=lambda item: order.get(item["id"], len(ids)))
    return jsonify(results)


@app.post("/api/case")
def create_case():
    payload = request.get_json(force=True, silent=True) or {}
    account_number = payload.get("account_number") or f"ACCT-{uuid.uuid4().hex[:6].upper()}"
    customer_name = payload.get("customer_name") or "New Customer"
    region = (payload.get("region") or "NA").upper()
    risk_score = int(payload.get("risk_score") or 50)
    summary = payload.get("summary") or "Generated from analyst triage panel."
    assigned_to = payload.get("assigned_to") or None
    due_days = int(payload.get("sar_due_in_days") or 7)
    sar_due_date = (datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=due_days)).isoformat()
    now_dt = datetime.datetime.now(datetime.UTC)
    now = now_dt.isoformat()

    db = get_db()
    cursor = db.execute(
        """
        INSERT INTO cases (account_number, customer_name, region, risk_score, status, summary, assigned_to, sar_due_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'triage', ?, ?, ?, ?, ?)
        """,
        (
            account_number,
            customer_name,
            region,
            risk_score,
            summary,
            assigned_to,
            sar_due_date,
            now,
            now,
        ),
    )
    case_id = cursor.lastrowid

    actor = get_request_actor() or CURRENT_ANALYST
    db.execute(
        """
        INSERT INTO case_notes (case_id, author, body, category, created_at)
        VALUES (?, ?, ?, 'system_event', ?)
        """,
        (
            case_id,
            actor,
            f"Case created in triage by {actor}.",
            now,
        ),
    )
    if assigned_to:
        db.execute(
            "INSERT OR IGNORE INTO case_watchers (case_id, watcher, created_at) VALUES (?, ?, ?)",
            (case_id, assigned_to, now),
        )
    db.commit()

    dashboard_directives = _global_dashboard_directives(db, now=now_dt)

    directives = [
        {"op": "refresh_item", "name": "case", "id": case_id},
        {"op": "refresh_collection", "name": "cases"},
        {
            "op": "refresh_collection",
            "name": "cases",
            "params": {"status": "triage"},
            "params_mode": "contains",
        },
        {"op": "refresh_item", "name": "caseTimeline", "id": case_id},
    ]
    directives.extend(dashboard_directives)
    emit_directives(directives, get_request_client_id(), audience="global")
    response_payload = _with_optional_directives({"ok": True}, directives)
    return jsonify(response_payload)


@app.post("/api/case/<int:case_id>/assign")
def assign_case(case_id: int):
    payload = request.get_json(force=True, silent=True) or {}
    assigned_to = payload.get("assigned_to")
    db = get_db()
    row = db.execute("SELECT status FROM cases WHERE id = ?", (case_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404

    now_dt = datetime.datetime.now(datetime.UTC)
    now = now_dt.isoformat()
    actor = get_request_actor() or CURRENT_ANALYST
    db.execute(
        "UPDATE cases SET assigned_to = ?, updated_at = ? WHERE id = ?",
        (assigned_to or None, now, case_id),
    )
    note_body = "Case unassigned"
    if assigned_to:
        note_body = f"Assigned to {assigned_to}"
        db.execute(
            "INSERT OR IGNORE INTO case_watchers (case_id, watcher, created_at) VALUES (?, ?, ?)",
            (case_id, assigned_to, now),
        )
    db.execute(
        """
        INSERT INTO case_notes (case_id, author, body, category, created_at)
        VALUES (?, ?, ?, 'assignment', ?)
        """,
        (case_id, actor, note_body, now),
    )
    db.commit()

    dashboard_directives = _global_dashboard_directives(db, now=now_dt)

    directives = [
        {"op": "refresh_item", "name": "case", "id": case_id},
        {"op": "refresh_collection", "name": "cases"},
        {
            "op": "refresh_collection",
            "name": "cases",
            "params": {"status": row["status"]},
            "params_mode": "contains",
        },
        {"op": "refresh_item", "name": "caseTimeline", "id": case_id},
    ]
    directives.extend(dashboard_directives)
    emit_directives(directives, get_request_client_id(), audience="global")
    response_payload = _with_optional_directives({"ok": True}, directives)
    return jsonify(response_payload)


@app.post("/api/case/<int:case_id>/transition")
def transition_case(case_id: int):
    payload = request.get_json(force=True, silent=True) or {}
    next_status = (payload.get("next_status") or "").strip().lower()
    note = payload.get("note")

    if next_status not in CASE_STATUSES:
        return jsonify({"error": "Invalid status"}), 400

    db = get_db()
    row = db.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404

    current_status = row["status"]
    allowed = ALLOWED_TRANSITIONS.get(current_status, set())
    if next_status not in allowed:
        return jsonify({"error": f"Transition from {current_status} to {next_status} not permitted"}), 400

    now_dt = datetime.datetime.now(datetime.UTC)
    now = now_dt.isoformat()
    sar_due_date = row["sar_due_date"]

    if next_status == "ready_for_sar" and not sar_due_date:
        sar_due_date = (datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=3)).isoformat()
    if next_status == "sar_filed":
        sar_due_date = (datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=1)).isoformat()

    actor = get_request_actor() or CURRENT_ANALYST
    db.execute(
        """
        UPDATE cases
        SET status = ?,
            updated_at = ?,
            sar_due_date = ?,
            last_transition_note = ?,
            assigned_to = COALESCE(assigned_to, ?)
        WHERE id = ?
        """,
        (
            next_status,
            now,
            sar_due_date,
            note,
            payload.get("default_assignee"),
            case_id,
        ),
    )
    db.execute(
        """
        INSERT INTO case_transitions (case_id, from_status, to_status, note, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (case_id, current_status, next_status, note, actor, now),
    )
    if note:
        db.execute(
            """
            INSERT INTO case_notes (case_id, author, body, category, created_at)
            VALUES (?, ?, ?, 'transition_note', ?)
            """,
            (case_id, actor, note, now),
        )
    db.commit()

    refreshed_row = db.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()

    directive_payload: Dict[str, Any] = {"op": "refresh_item", "name": "case", "id": case_id}
    if refreshed_row:
        simplified = {
            "id": refreshed_row["id"],
            "account_number": refreshed_row["account_number"],
            "customer_name": refreshed_row["customer_name"],
            "region": refreshed_row["region"],
            "risk_score": refreshed_row["risk_score"],
            "status": refreshed_row["status"],
            "sar_due_date": refreshed_row["sar_due_date"],
            "assigned_to": refreshed_row["assigned_to"],
            "updated_at": refreshed_row["updated_at"],
        }
        expanded = dict(simplified)
        expanded.update(
            {
                "summary": refreshed_row["summary"],
                "created_at": refreshed_row["created_at"],
                "last_transition_note": refreshed_row["last_transition_note"],
            }
        )
        directive_payload["result"] = {
            "ts": now,
            "levels": {
                "simplified": simplified,
                "expanded": expanded,
            },
        }

    dashboard_directives = _global_dashboard_directives(db, now=now_dt)

    directives: list[Dict[str, Any]] = [
        directive_payload,
        {"op": "refresh_collection", "name": "cases"},
        {
            "op": "refresh_collection",
            "name": "cases",
            "params": {"status": current_status},
            "params_mode": "contains",
        },
        {
            "op": "refresh_collection",
            "name": "cases",
            "params": {"status": next_status},
            "params_mode": "contains",
        },
        {
            "op": "refresh_collection",
            "name": "caseTimeline",
            "params": {"case_id": case_id},
            "params_mode": "contains",
        },
    ]
    directives.extend(dashboard_directives)

    emit_directives(directives, get_request_client_id(), audience="global")
    response_payload = _with_optional_directives({"ok": True}, directives)
    return jsonify(response_payload)


@app.post("/api/case/<int:case_id>/notes")
def add_case_note(case_id: int):
    payload = request.get_json(force=True, silent=True) or {}
    body = (payload.get("body") or "").strip()
    if not body:
        return jsonify({"error": "Note body is required"}), 400
    category = (payload.get("category") or "analyst_note").strip() or "analyst_note"
    author = payload.get("author") or get_request_actor() or CURRENT_ANALYST

    db = get_db()
    exists = db.execute("SELECT status FROM cases WHERE id = ?", (case_id,)).fetchone()
    if not exists:
        return jsonify({"error": "Not found"}), 404

    now_dt = datetime.datetime.now(datetime.UTC)
    now = now_dt.isoformat()
    db.execute(
        """
        INSERT INTO case_notes (case_id, author, body, category, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (case_id, author, body, category, now),
    )
    db.execute(
        "UPDATE cases SET updated_at = ? WHERE id = ?",
        (now, case_id),
    )
    db.commit()

    dashboard_directives = _global_dashboard_directives(db, now=now_dt)

    directives = [
        {"op": "refresh_item", "name": "case", "id": case_id},
        {
            "op": "refresh_collection",
            "name": "caseTimeline",
            "params": {"case_id": case_id},
            "params_mode": "contains",
        },
    ]
    directives.extend(dashboard_directives)
    emit_directives(directives, get_request_client_id(), audience="global")
    response_payload = _with_optional_directives({"ok": True}, directives)
    return jsonify(response_payload)


@app.post("/api/case/<int:case_id>/watchers")
def update_case_watchers(case_id: int):
    payload = request.get_json(force=True, silent=True) or {}
    watcher = (payload.get("watcher") or "").strip().lower()
    action = (payload.get("action") or "toggle").strip().lower()
    if not watcher:
        return jsonify({"error": "Watcher is required"}), 400

    db = get_db()
    exists = db.execute("SELECT status FROM cases WHERE id = ?", (case_id,)).fetchone()
    if not exists:
        return jsonify({"error": "Not found"}), 404

    now_dt = datetime.datetime.now(datetime.UTC)
    now = now_dt.isoformat()
    current = db.execute(
        "SELECT watcher FROM case_watchers WHERE case_id = ? AND watcher = ?",
        (case_id, watcher),
    ).fetchone()

    changed = False
    description = None
    if action in {"remove", "delete"}:
        if current:
            db.execute("DELETE FROM case_watchers WHERE case_id = ? AND watcher = ?", (case_id, watcher))
            changed = True
            description = f"Removed watcher {watcher}"
    elif action == "add":
        if not current:
            db.execute(
                "INSERT INTO case_watchers (case_id, watcher, created_at) VALUES (?, ?, ?)",
                (case_id, watcher, now),
            )
            changed = True
            description = f"Added watcher {watcher}"
    else:  # toggle
        if current:
            db.execute("DELETE FROM case_watchers WHERE case_id = ? AND watcher = ?", (case_id, watcher))
            changed = True
            description = f"Removed watcher {watcher}"
        else:
            db.execute(
                "INSERT INTO case_watchers (case_id, watcher, created_at) VALUES (?, ?, ?)",
                (case_id, watcher, now),
            )
            changed = True
            description = f"Added watcher {watcher}"

    if not changed:
        watchers = _fetch_watchers(db, case_id)
        return jsonify({"ok": True, "changed": False, "watchers": watchers})

    actor = get_request_actor() or CURRENT_ANALYST
    identity = _resolve_roster_identity(watcher)
    friendly = identity.get("name") or watcher
    db.execute(
        """
        INSERT INTO case_notes (case_id, author, body, category, created_at)
        VALUES (?, ?, ?, 'watcher_update', ?)
        """,
        (case_id, actor, f"{description} ({friendly})", now),
    )
    db.execute("UPDATE cases SET updated_at = ? WHERE id = ?", (now, case_id))
    db.commit()

    watchers = _fetch_watchers(db, case_id)
    dashboard_directives = _global_dashboard_directives(db, now=now_dt)

    directives = [
        {"op": "refresh_item", "name": "case", "id": case_id},
        {
            "op": "refresh_collection",
            "name": "caseTimeline",
            "params": {"case_id": case_id},
            "params_mode": "contains",
        },
    ]
    directives.extend(dashboard_directives)
    emit_directives(directives, get_request_client_id(), audience="global")
    response_payload = _with_optional_directives({"ok": True, "watchers": watchers}, directives)
    return jsonify(response_payload)


@app.get("/api/dashboard/summary")
def dashboard_summary():
    db = get_db()
    payload = _compute_dashboard_summary(db)
    response = jsonify(payload)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/api/dashboard/filings")
def dashboard_filings():
    db = get_db()
    payload = _compute_filing_schedule(db)
    response = jsonify(payload)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/api/dashboard/watchlist")
def dashboard_watchlist():
    db = get_db()
    payload = _compute_watchlist_overview(db)
    response = jsonify(payload)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/api/dashboard/insights")
def dashboard_insights():
    db = get_db()
    payload = _compute_analytics_insights(db)
    response = jsonify(payload)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/api/reference/team")
def team_reference():
    return jsonify({"reviewers": TEAM_ROSTER})


@app.get("/api/session/context")
def session_context():
    actor = get_request_actor() or CURRENT_ANALYST
    return jsonify({"current_user": actor})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
