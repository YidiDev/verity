from __future__ import annotations

import datetime as _dt
import json
import math
import queue
import threading
import uuid
from copy import deepcopy
from pathlib import Path
import sys
from typing import Any, Dict, Iterable, Set

from flask import (
    Flask,
    Response,
    jsonify,
    render_template,
    request,
    stream_with_context,
)

CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

app = Flask(
    __name__,
    static_url_path="/static",
    static_folder=str(CURRENT_DIR / "static"),
    template_folder=str(CURRENT_DIR / "templates"),
)


# ---------------------------------------------------------------------------
# In-memory "ground truth"
# ---------------------------------------------------------------------------

def _iso_now() -> str:
    return _dt.datetime.now(_dt.UTC).isoformat()


def _minutes_from_now(minutes: int) -> str:
    return (_dt.datetime.now(_dt.UTC) + _dt.timedelta(minutes=minutes)).isoformat()


def _minutes_ago(minutes: int) -> str:
    return (_dt.datetime.now(_dt.UTC) - _dt.timedelta(minutes=minutes)).isoformat()


def _deepcopy(data: Any) -> Any:
    return deepcopy(data)


DATA_LOCK = threading.Lock()


def _reference(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6].upper()}"

LINES: Dict[str, Dict[str, Any]] = {
    "press-01": {
        "id": "press-01",
        "name": "Press Line 01",
        "status": "Running",
        "oee": 92.4,
        "active_sku": "P-900 Rotor",
        "crew_lead": "Maria Chen",
        "line_goal_units": 960,
        "last_updated": _iso_now(),
        "skus": [
            {
                "sku": "P-900",
                "description": "Rotor Assembly",
                "shift_output": 420,
                "quality_yield": 98.7,
                "queued_orders": 6,
            },
            {
                "sku": "PX-220",
                "description": "Compressor Housing",
                "shift_output": 360,
                "quality_yield": 97.9,
                "queued_orders": 4,
            },
        ],
    },
    "assembly-02": {
        "id": "assembly-02",
        "name": "Final Assembly 02",
        "status": "Running",
        "oee": 88.6,
        "active_sku": "AX-410 Pump",
        "crew_lead": "Logan Patel",
        "line_goal_units": 720,
        "last_updated": _iso_now(),
        "skus": [
            {
                "sku": "AX-410",
                "description": "Hydraulic Pump",
                "shift_output": 305,
                "quality_yield": 96.2,
                "queued_orders": 9,
            },
            {
                "sku": "AX-410-R",
                "description": "Pump Retrofit Kit",
                "shift_output": 88,
                "quality_yield": 95.4,
                "queued_orders": 2,
            },
        ],
    },
    "packout-05": {
        "id": "packout-05",
        "name": "Packout 05",
        "status": "Running",
        "oee": 94.1,
        "active_sku": "Service Kit S-12",
        "crew_lead": "Claudia Reyes",
        "line_goal_units": 1320,
        "last_updated": _iso_now(),
        "skus": [
            {
                "sku": "S-12",
                "description": "Service Kit",
                "shift_output": 512,
                "quality_yield": 99.1,
                "queued_orders": 11,
            },
            {
                "sku": "S-12X",
                "description": "Service Kit Deluxe",
                "shift_output": 380,
                "quality_yield": 98.8,
                "queued_orders": 5,
            },
        ],
    },
}

_ADDITIONAL_LINES = [
    {
        "id": "machining-03",
        "name": "CNC Cell 03",
        "status": "Changeover",
        "status_detail": "Tool change on spindle 4",
        "oee": 81.2,
        "active_sku": "Rotor hub RH-12",
        "crew_lead": "Evan Doyle",
        "line_goal_units": 540,
        "minutes_ago": 4,
        "skus": [
            {
                "sku": "RH-12",
                "description": "Rotor Hub",
                "shift_output": 210,
                "quality_yield": 97.1,
                "queued_orders": 7,
            },
            {
                "sku": "RH-12L",
                "description": "Rotor Hub — Long",
                "shift_output": 95,
                "quality_yield": 96.4,
                "queued_orders": 3,
            },
        ],
    },
    {
        "id": "welding-04",
        "name": "Robotic Weld 04",
        "status": "Running",
        "oee": 90.1,
        "active_sku": "Frame weldment FW-22",
        "crew_lead": "Tatiana Brooks",
        "line_goal_units": 840,
        "minutes_ago": 11,
        "skus": [
            {
                "sku": "FW-22",
                "description": "Frame Weldment",
                "shift_output": 400,
                "quality_yield": 98.4,
                "queued_orders": 8,
            },
            {
                "sku": "FW-22S",
                "description": "Frame Weldment Short",
                "shift_output": 188,
                "quality_yield": 97.6,
                "queued_orders": 5,
            },
        ],
    },
    {
        "id": "coating-06",
        "name": "Powder Coat 06",
        "status": "Running",
        "oee": 93.2,
        "active_sku": "Enclosure panels",
        "crew_lead": "Noelle Carter",
        "line_goal_units": 1100,
        "minutes_ago": 6,
        "skus": [
            {
                "sku": "PC-500",
                "description": "Panel Set",
                "shift_output": 520,
                "quality_yield": 99.2,
                "queued_orders": 6,
            },
            {
                "sku": "PC-500M",
                "description": "Marine Panel Set",
                "shift_output": 180,
                "quality_yield": 98.1,
                "queued_orders": 2,
            },
        ],
    },
    {
        "id": "fabrication-07",
        "name": "Fabrication Bay 07",
        "status": "Running",
        "oee": 86.9,
        "active_sku": "Chassis rail CR-75",
        "crew_lead": "Omar Wallace",
        "line_goal_units": 680,
        "minutes_ago": 14,
        "skus": [
            {
                "sku": "CR-75",
                "description": "Chassis Rail",
                "shift_output": 330,
                "quality_yield": 97.0,
                "queued_orders": 4,
            },
            {
                "sku": "CR-75K",
                "description": "Chassis Rail Kit",
                "shift_output": 140,
                "quality_yield": 96.8,
                "queued_orders": 2,
            },
        ],
    },
    {
        "id": "molding-08",
        "name": "Injection Molding 08",
        "status": "Running",
        "oee": 89.4,
        "active_sku": "Reservoir cap RC-12",
        "crew_lead": "Priya Natarajan",
        "line_goal_units": 1500,
        "minutes_ago": 5,
        "skus": [
            {
                "sku": "RC-12",
                "description": "Reservoir Cap",
                "shift_output": 650,
                "quality_yield": 99.3,
                "queued_orders": 12,
            },
            {
                "sku": "RC-12V",
                "description": "Reservoir Cap Vent",
                "shift_output": 210,
                "quality_yield": 98.9,
                "queued_orders": 4,
            },
        ],
    },
    {
        "id": "testing-09",
        "name": "Endurance Test 09",
        "status": "Running",
        "oee": 95.6,
        "active_sku": "Pump validation",
        "crew_lead": "Jeremiah Holt",
        "line_goal_units": 420,
        "minutes_ago": 8,
        "skus": [
            {
                "sku": "AX-410",
                "description": "Hydraulic Pump",
                "shift_output": 140,
                "quality_yield": 99.7,
                "queued_orders": 3,
            },
            {
                "sku": "PX-220",
                "description": "Compressor Housing",
                "shift_output": 90,
                "quality_yield": 99.1,
                "queued_orders": 2,
            },
        ],
    },
    {
        "id": "reman-10",
        "name": "Remanufacturing 10",
        "status": "Running",
        "oee": 87.5,
        "active_sku": "Return kit RK-30",
        "crew_lead": "Yara Idris",
        "line_goal_units": 560,
        "minutes_ago": 10,
        "skus": [
            {
                "sku": "RK-30",
                "description": "Return Kit",
                "shift_output": 260,
                "quality_yield": 95.5,
                "queued_orders": 6,
            },
            {
                "sku": "RK-30R",
                "description": "Return Kit Refurb",
                "shift_output": 120,
                "quality_yield": 94.8,
                "queued_orders": 3,
            },
        ],
    },
]

for blueprint in _ADDITIONAL_LINES:
    entry = _deepcopy(blueprint)
    minutes_ago = entry.pop("minutes_ago", 0)
    entry["last_updated"] = _minutes_ago(minutes_ago)
    LINES[entry["id"]] = entry

ALL_LINE_IDS = tuple(sorted(LINES.keys()))

USERS: Dict[str, Dict[str, Any]] = {
    "supervisor-amelia": {
        "id": "supervisor-amelia",
        "name": "Amelia Lawson",
        "role": "Plant Supervisor",
        "description": "Sees the full control room state and manages shift handoff.",
        "scopes": {"overview", "quality", "maintenance", "logistics", "safety", "handover"},
        "line_access": {"*"},
        "default_page": "overview",
    },
    "maintenance-roster": {
        "id": "maintenance-roster",
        "name": "Maintenance Dispatch",
        "role": "Maintenance Coordinator",
        "description": "Focuses on machining, welding, and reman cells while coordinating technicians.",
        "scopes": {"overview", "maintenance", "handover"},
        "line_access": {"press-01", "machining-03", "welding-04", "coating-06", "reman-10"},
        "default_page": "maintenance",
    },
    "safety-ehs": {
        "id": "safety-ehs",
        "name": "EHS Lead",
        "role": "Safety & Compliance",
        "description": "Reviews incidents, safety walks, and training coverage across the plant.",
        "scopes": {"overview", "safety", "handover"},
        "line_access": {"*"},
        "default_page": "safety",
    },
    "logistics-dock": {
        "id": "logistics-dock",
        "name": "Dock Control",
        "role": "Logistics Desk",
        "description": "Monitors inbound materials, inventory coverage, and outbound loads for shipping lines.",
        "scopes": {"logistics"},
        "line_access": {"assembly-02", "packout-05", "testing-09"},
        "default_page": "logistics",
    },
}

DEFAULT_USER_ID = "supervisor-amelia"

VALID_VISIBILITY_SCOPES: Set[str] = {
    "overview",
    "quality",
    "maintenance",
    "logistics",
    "safety",
    "handover",
}


def _user_scopes(user: Dict[str, Any]) -> Set[str]:
    return set(user.get("scopes", ()))


def _user_line_access(user: Dict[str, Any]) -> Set[str]:
    configured = set(user.get("line_access", ()))
    if "*" in configured:
        return set(LINES.keys())
    return {line_id for line_id in configured if line_id in LINES}


def _resolve_user(user_id: str | None) -> Dict[str, Any]:
    if user_id and user_id in USERS:
        return USERS[user_id]
    return USERS[DEFAULT_USER_ID]


def _normalize_visibility(visibility: Iterable[str] | None) -> Set[str]:
    if not visibility:
        return set()
    normalized = {str(tag) for tag in visibility}
    return {tag for tag in normalized if tag in VALID_VISIBILITY_SCOPES}


def _export_user_directory() -> Dict[str, Any]:
    directory = []
    for meta in USERS.values():
        scopes = sorted(_user_scopes(meta))
        allowed_lines = sorted(_user_line_access(meta))
        if len(allowed_lines) == len(LINES):
            line_display = "All production lines"
        elif not allowed_lines:
            line_display = "No line feeds"
        else:
            line_display = ", ".join(allowed_lines)
        directory.append(
            {
                "id": meta["id"],
                "name": meta["name"],
                "role": meta["role"],
                "description": meta.get("description", ""),
                "scopes": scopes,
                "line_access": allowed_lines,
                "line_access_display": line_display,
                "default_page": meta.get("default_page", "overview"),
            }
        )
    directory.sort(key=lambda entry: entry["name"])
    return {"default": DEFAULT_USER_ID, "users": directory}


def _user_has_scope(user: Dict[str, Any], scope: str) -> bool:
    return scope in _user_scopes(user)


def _filter_sequence_by_scope(
    sequence: list[Dict[str, Any]],
    *,
    scope: str,
    user: Dict[str, Any],
    line_key: str | None = "line_id",
) -> list[Dict[str, Any]]:
    if not _user_has_scope(user, scope):
        return []
    if line_key is None:
        return sequence
    allowed_lines = _user_line_access(user)
    if not allowed_lines:
        return [item for item in sequence if not isinstance(item, dict) or not item.get(line_key)]
    filtered: list[Dict[str, Any]] = []
    for item in sequence:
        if not isinstance(item, dict):
            continue
        line_id = item.get(line_key)
        if not line_id or line_id in allowed_lines:
            filtered.append(item)
    return filtered


RECENT_DEFECTS: list[Dict[str, Any]] = [
    {
        "id": uuid.uuid4().hex,
        "line_id": "press-01",
        "sku": "PX-220",
        "severity": "major",
        "description": "Surface blemish near mounting flange",
        "detected_at": _iso_now(),
        "containment": "Hold pallets from 14:00 batch",
    },
    {
        "id": uuid.uuid4().hex,
        "line_id": "assembly-02",
        "sku": "AX-410",
        "severity": "minor",
        "description": "Torque spec variance detected at station 4",
        "detected_at": _iso_now(),
        "containment": "Recalibrate wrench + audit last 25 units",
    },
]

_RECENT_DEFECT_ADDITIONS = [
    {
        "line_id": "machining-03",
        "sku": "RH-12",
        "severity": "major",
        "description": "Tool wear causing burr on flange",
        "containment": "Change inserts and deburr affected lot",
        "minutes_ago": 18,
    },
    {
        "line_id": "molding-08",
        "sku": "RC-12",
        "severity": "minor",
        "description": "Short shot detected on cavity 3",
        "containment": "Adjust barrel temperature and purge",
        "minutes_ago": 24,
    },
    {
        "line_id": "fabrication-07",
        "sku": "CR-75",
        "severity": "critical",
        "description": "Laser pierce out of tolerance",
        "containment": "Hold three racks for metrology review",
        "minutes_ago": 31,
    },
    {
        "line_id": "welding-04",
        "sku": "FW-22",
        "severity": "major",
        "description": "Porosity flagged by vision sensor",
        "containment": "Rework four fixtures and adjust gas mix",
        "minutes_ago": 37,
    },
    {
        "line_id": "packout-05",
        "sku": "S-12",
        "severity": "minor",
        "description": "Missing hardware in kit drawer",
        "containment": "Audit last 30 kits and add weigh count",
        "minutes_ago": 46,
    },
    {
        "line_id": "press-01",
        "sku": "P-900",
        "severity": "major",
        "description": "Oil groove depth out of spec",
        "containment": "Operator hold and dimensional study",
        "minutes_ago": 55,
    },
    {
        "line_id": "testing-09",
        "sku": "AX-410",
        "severity": "minor",
        "description": "Cycle aborted due to thermal drift",
        "containment": "Swap instrumentation and rerun sample",
        "minutes_ago": 63,
    },
    {
        "line_id": "reman-10",
        "sku": "RK-30",
        "severity": "minor",
        "description": "Incorrect gasket in return kit",
        "containment": "Sort staging buffer and notify supplier",
        "minutes_ago": 72,
    },
    {
        "line_id": "coating-06",
        "sku": "PC-500",
        "severity": "minor",
        "description": "Powder build-up at hanger",
        "containment": "Clean hooks and add air knife check",
        "minutes_ago": 80,
    },
    {
        "line_id": "assembly-02",
        "sku": "AX-410-R",
        "severity": "major",
        "description": "Accessory harness misrouted",
        "containment": "Stop line and add go/no-go photo",
        "minutes_ago": 92,
    },
]

for blueprint in _RECENT_DEFECT_ADDITIONS:
    RECENT_DEFECTS.append(
        {
            "id": uuid.uuid4().hex,
            "line_id": blueprint["line_id"],
            "sku": blueprint["sku"],
            "severity": blueprint["severity"],
            "description": blueprint["description"],
            "detected_at": _minutes_ago(blueprint["minutes_ago"]),
            "containment": blueprint["containment"],
        }
    )

DOWNTIME_EVENTS: list[Dict[str, Any]] = [
    {
        "id": uuid.uuid4().hex,
        "line_id": "packout-05",
        "reason": "Cartoner fault",
        "reported_by": "Operator: A. Singh",
        "started_at": (_dt.datetime.now(_dt.UTC) - _dt.timedelta(minutes=32)).isoformat(),
        "expected_resolution": _minutes_from_now(5),
        "status": "Investigating",
    }
]

_DOWNTIME_ADDITIONS = [
    {
        "line_id": "machining-03",
        "reason": "Spindle vibration alarm",
        "reported_by": "Operator: L. Nguyen",
        "minutes_ago": 18,
        "eta_minutes": 12,
        "status": "Awaiting maintenance",
    },
    {
        "line_id": "fabrication-07",
        "reason": "Laser chiller low flow",
        "reported_by": "Lead: O. Wallace",
        "minutes_ago": 45,
        "eta_minutes": 20,
        "status": "Technician dispatched",
    },
    {
        "line_id": "welding-04",
        "reason": "Robot teach lock",
        "reported_by": "Operator: S. Romero",
        "minutes_ago": 11,
        "eta_minutes": 8,
        "status": "Resetting",
    },
    {
        "line_id": "molding-08",
        "reason": "Material dryer fault",
        "reported_by": "Operator: P. Singh",
        "minutes_ago": 57,
        "eta_minutes": 25,
        "status": "Parts on hold",
    },
    {
        "line_id": "assembly-02",
        "reason": "Torque station review",
        "reported_by": "QA: R. Owens",
        "minutes_ago": 8,
        "eta_minutes": 5,
        "status": "Auditing",
    },
    {
        "line_id": "reman-10",
        "reason": "Return core mismatch",
        "reported_by": "Operator: G. Adams",
        "minutes_ago": 68,
        "eta_minutes": 30,
        "status": "Waiting on engineering",
    },
    {
        "line_id": "coating-06",
        "reason": "Conveyor drive fault",
        "reported_by": "Lead: N. Carter",
        "minutes_ago": 24,
        "eta_minutes": 10,
        "status": "Spare belt en route",
    },
]

for blueprint in _DOWNTIME_ADDITIONS:
    DOWNTIME_EVENTS.append(
        {
            "id": uuid.uuid4().hex,
            "line_id": blueprint["line_id"],
            "reason": blueprint["reason"],
            "reported_by": blueprint["reported_by"],
            "started_at": _minutes_ago(blueprint["minutes_ago"]),
            "expected_resolution": _minutes_from_now(blueprint["eta_minutes"]),
            "status": blueprint["status"],
        }
    )

MAX_DEFECTS = 60
MAX_DOWNTIME = 60

QUALITY_SUMMARY: Dict[str, Any] = {
    "first_pass_yield": 97.8,
    "containment_actions": 3,
    "audits_due": 2,
    "last_updated": _iso_now(),
    "top_defects": [
        {
            "sku": "AX-410",
            "issue": "Torque variance at station 4",
            "count": 3,
            "status": "Line walk ongoing",
        },
        {
            "sku": "P-900",
            "issue": "Seal leak at pressure test",
            "count": 2,
            "status": "Containment complete",
        },
        {
            "sku": "S-12",
            "issue": "Missing hardware in kits",
            "count": 1,
            "status": "Supplier audit scheduled",
        },
    ],
}

QUALITY_SUMMARY.update(
    {
        "first_pass_yield": 97.4,
        "containment_actions": 6,
        "audits_due": 3,
        "last_updated": _minutes_ago(5),
        "top_defects": [
            {
                "sku": "CR-75",
                "issue": "Laser pierce drift",
                "count": 4,
                "status": "Fixture swap complete",
            },
            {
                "sku": "PX-220",
                "issue": "Surface blemish",
                "count": 3,
                "status": "Hold released after polish",
            },
            {
                "sku": "RC-12",
                "issue": "Short shot",
                "count": 2,
                "status": "Dryer maintenance scheduled",
            },
            {
                "sku": "S-12",
                "issue": "Missing fasteners",
                "count": 2,
                "status": "Weigh count enabled",
            },
        ],
    }
)

QUALITY_AUDITS: list[Dict[str, Any]] = [
    {
        "id": uuid.uuid4().hex,
        "line_id": "press-01",
        "sku": "PX-220",
        "performed_by": "QA: B. Flores",
        "summary": "Pulled 5 pcs from buffer — blemish contained to lot 512.",
        "logged_at": (_dt.datetime.now(_dt.UTC) - _dt.timedelta(minutes=25)).isoformat(),
        "status": "Monitoring",
    },
    {
        "id": uuid.uuid4().hex,
        "line_id": "assembly-02",
        "sku": "AX-410",
        "performed_by": "QA: M. Grant",
        "summary": "Torque wrenches recalibrated; added layered sign-off.",
        "logged_at": (_dt.datetime.now(_dt.UTC) - _dt.timedelta(hours=1, minutes=5)).isoformat(),
        "status": "Closed",
    },
]

_QUALITY_AUDIT_ADDITIONS = [
    {
        "line_id": "molding-08",
        "sku": "RC-12",
        "performed_by": "QA: M. Santos",
        "summary": "Short shot purge verified, mold temperatures reset.",
        "status": "Monitoring",
        "minutes_ago": 38,
    },
    {
        "line_id": "machining-03",
        "sku": "RH-12",
        "performed_by": "Process: M. Chen",
        "summary": "Tool life extended with revised offsets.",
        "status": "Open",
        "minutes_ago": 52,
    },
    {
        "line_id": "fabrication-07",
        "sku": "CR-75K",
        "performed_by": "QA: M. Caro",
        "summary": "Bracket holes re-verified with new fixture.",
        "status": "Closed",
        "minutes_ago": 80,
    },
    {
        "line_id": "welding-04",
        "sku": "FW-22",
        "performed_by": "QA: M. Duong",
        "summary": "Porosity rework validated, robot program updated.",
        "status": "Monitoring",
        "minutes_ago": 44,
    },
    {
        "line_id": "packout-05",
        "sku": "S-12",
        "performed_by": "QA: G. Lane",
        "summary": "Secondary kit verification added to SOP.",
        "status": "Open",
        "minutes_ago": 58,
    },
    {
        "line_id": "testing-09",
        "sku": "AX-410",
        "performed_by": "Engineer: K. Rivera",
        "summary": "Thermal drift study launched with data loggers.",
        "status": "Open",
        "minutes_ago": 92,
    },
    {
        "line_id": "reman-10",
        "sku": "RK-30",
        "performed_by": "QA: P. Howard",
        "summary": "Return kit audit found supplier mislabel; CAR opened.",
        "status": "Open",
        "minutes_ago": 110,
    },
    {
        "line_id": "coating-06",
        "sku": "PC-500",
        "performed_by": "QA: T. Ramos",
        "summary": "Hook clean process verified; fan guards added.",
        "status": "Closed",
        "minutes_ago": 74,
    },
]

for blueprint in _QUALITY_AUDIT_ADDITIONS:
    QUALITY_AUDITS.append(
        {
            "id": uuid.uuid4().hex,
            "line_id": blueprint["line_id"],
            "sku": blueprint["sku"],
            "performed_by": blueprint["performed_by"],
            "summary": blueprint["summary"],
            "logged_at": _minutes_ago(blueprint["minutes_ago"]),
            "status": blueprint["status"],
        }
    )

MAINTENANCE_BACKLOG: list[Dict[str, Any]] = [
    {
        "id": uuid.uuid4().hex,
        "asset": "Press 01 — Lubrication circuit",
        "priority": "High",
        "due": _minutes_from_now(90),
        "owner": "Tech: R. Patel",
        "status": "Awaiting spare",
    },
    {
        "id": uuid.uuid4().hex,
        "asset": "Assembly 02 — Vision sensor",
        "priority": "Medium",
        "due": _minutes_from_now(240),
        "owner": "Tech: L. Gomez",
        "status": "Scheduled",
    },
    {
        "id": uuid.uuid4().hex,
        "asset": "Packout 05 — Case sealer",
        "priority": "Low",
        "due": _minutes_from_now(480),
        "owner": "Tech: J. Howard",
        "status": "Inspection",
    },
]

MAINTENANCE_BACKLOG.extend(
    [
        {
            "id": uuid.uuid4().hex,
            "asset": "Coating 06 — Booth exhaust",
            "priority": "High",
            "due": _minutes_from_now(180),
            "owner": "Tech: J. Valdez",
            "status": "Parts on order",
        },
        {
            "id": uuid.uuid4().hex,
            "asset": "Fabrication 07 — Laser optics",
            "priority": "Medium",
            "due": _minutes_from_now(320),
            "owner": "Tech: H. Muller",
            "status": "Clean and align",
        },
        {
            "id": uuid.uuid4().hex,
            "asset": "Molding 08 — Dryer desiccant",
            "priority": "Low",
            "due": _minutes_from_now(520),
            "owner": "Tech: E. Porter",
            "status": "Plan downtime",
        },
        {
            "id": uuid.uuid4().hex,
            "asset": "Testing 09 — Thermal chamber",
            "priority": "Medium",
            "due": _minutes_from_now(400),
            "owner": "Tech: J. Howard",
            "status": "Calibration",
        },
    ]
)

SHIFT_NOTES: list[Dict[str, Any]] = [
    {
        "id": uuid.uuid4().hex,
        "shift": "A",
        "author": "Supervisor: K. Winters",
        "focus": "Start of shift",
        "note": "Press 01 running 15 minutes behind goal due to earlier jam. Maintenance cleared.",
        "logged_at": (_dt.datetime.now(_dt.UTC) - _dt.timedelta(hours=2, minutes=10)).isoformat(),
    },
    {
        "id": uuid.uuid4().hex,
        "shift": "B",
        "author": "Supervisor: J. Wu",
        "focus": "Mid-shift",
        "note": "Packout backlog cleared; QA signed off rework lot 225.",
        "logged_at": (_dt.datetime.now(_dt.UTC) - _dt.timedelta(minutes=45)).isoformat(),
    },
]

_SHIFT_NOTE_ADDITIONS = [
    {
        "shift": "A",
        "author": "Supervisor: A. Hodge",
        "focus": "Safety brief",
        "note": "Reviewed crane inspection before heavy lifts.",
        "minutes_ago": 118,
    },
    {
        "shift": "B",
        "author": "Supervisor: R. Patel",
        "focus": "Quality",
        "note": "Extra layered check added to pump torque station.",
        "minutes_ago": 44,
    },
    {
        "shift": "C",
        "author": "Supervisor: D. King",
        "focus": "Planning",
        "note": "Night crew to prep coating racks for marine run.",
        "minutes_ago": 28,
    },
    {
        "shift": "C",
        "author": "Supervisor: Y. Idris",
        "focus": "Materials",
        "note": "Reman team short on RK-30 gaskets, supplier expedite requested.",
        "minutes_ago": 20,
    },
    {
        "shift": "A",
        "author": "Supervisor: C. Flores",
        "focus": "Training",
        "note": "New hire shadowing on injection molding today.",
        "minutes_ago": 172,
    },
    {
        "shift": "B",
        "author": "Supervisor: M. Ellis",
        "focus": "Maintenance",
        "note": "Laser chiller flush scheduled at 18:00, coordinate downtime.",
        "minutes_ago": 90,
    },
    {
        "shift": "A",
        "author": "Supervisor: P. Thomas",
        "focus": "Customer",
        "note": "Expedite order 18455 for DC East before 20:00 dock close.",
        "minutes_ago": 156,
    },
    {
        "shift": "C",
        "author": "Supervisor: N. Gomez",
        "focus": "Safety",
        "note": "Reminder on glove change frequency in welding cell.",
        "minutes_ago": 12,
    },
]

for blueprint in _SHIFT_NOTE_ADDITIONS:
    SHIFT_NOTES.append(
        {
            "id": uuid.uuid4().hex,
            "shift": blueprint["shift"],
            "author": blueprint["author"],
            "focus": blueprint["focus"],
            "note": blueprint["note"],
            "logged_at": _minutes_ago(blueprint["minutes_ago"]),
        }
    )

MAX_AUDITS = 150
MAX_SHIFT_NOTES = 150

SUPPLY_RUNS: list[Dict[str, Any]] = [
    {
        "id": uuid.uuid4().hex,
        "reference": _reference("INB"),
        "carrier": "Midwest Freight",
        "dock": "Dock 3",
        "status": "Checked In",
        "eta": _minutes_from_now(10),
        "line_id": "press-01",
        "material": "Billet AA-6061",
        "quantity": 9600,
        "uom": "kg",
        "notes": "Billet replenishment for Press 01",
        "logged_at": _iso_now(),
    },
    {
        "id": uuid.uuid4().hex,
        "reference": _reference("INB"),
        "carrier": "Rapid Metals",
        "dock": "Dock 1",
        "status": "En Route",
        "eta": _minutes_from_now(35),
        "line_id": "assembly-02",
        "material": "Seal kits",
        "quantity": 480,
        "uom": "kits",
        "notes": "Kitted hardware for AX-410",
        "logged_at": _iso_now(),
    },
]

_SUPPLY_RUN_TEMPLATES = [
    {
        "carrier": "Metro Steel",
        "dock": "Dock 6",
        "line_id": "fabrication-07",
        "material": "Plate stock",
        "base_quantity": 12400,
        "uom": "kg",
        "notes": "Laser blanks for chassis rails",
    },
    {
        "carrier": "Resin Express",
        "dock": "Dock 7",
        "line_id": "molding-08",
        "material": "Polymer resin",
        "base_quantity": 3200,
        "uom": "kg",
        "notes": "RC-12 resin lot 48",
    },
    {
        "carrier": "Northline",
        "dock": "Dock 2",
        "line_id": "packout-05",
        "material": "Carton stock",
        "base_quantity": 8200,
        "uom": "sheets",
        "notes": "Printed cartons for S-12 kits",
    },
    {
        "carrier": "Shared Shuttle",
        "dock": "Dock 4",
        "line_id": None,
        "material": "Consumables",
        "base_quantity": 120,
        "uom": "crates",
        "notes": "Shared PPE replenishment",
    },
    {
        "carrier": "Rapid Logistics",
        "dock": "Dock 1",
        "line_id": "assembly-02",
        "material": "Pump bodies",
        "base_quantity": 540,
        "uom": "units",
        "notes": "Casting lot 18B inbound",
    },
]

for idx in range(24):
    template = _SUPPLY_RUN_TEMPLATES[idx % len(_SUPPLY_RUN_TEMPLATES)]
    status_cycle = ["Checked In", "En Route", "Unloaded"]
    status = status_cycle[idx % len(status_cycle)]
    SUPPLY_RUNS.append(
        {
            "id": uuid.uuid4().hex,
            "reference": _reference("INB"),
            "carrier": template["carrier"],
            "dock": template["dock"],
            "status": status,
            "eta": _minutes_from_now(8 + (idx % 6) * 7),
            "line_id": template["line_id"],
            "material": template["material"],
            "quantity": template["base_quantity"] + (idx % 5) * 140,
            "uom": template["uom"],
            "notes": template["notes"],
            "logged_at": _minutes_ago(idx * 5 + 3),
        }
    )

OUTBOUND_SHIPMENTS: list[Dict[str, Any]] = [
    {
        "id": uuid.uuid4().hex,
        "reference": _reference("OUT"),
        "destination": "Regional DC East",
        "dock": "Dock 5",
        "status": "Staged",
        "departing_at": _minutes_from_now(50),
        "line_id": "packout-05",
        "contents": "Service Kit S-12 (2 pallets)",
        "trailer": "TR-2741",
        "logged_at": _iso_now(),
    }
]

_OUTBOUND_TEMPLATES = [
    {
        "destination": "OEM Engine Plant",
        "dock": "Dock 8",
        "line_id": "assembly-02",
        "contents": "AX-410 pumps",
        "trailer": "TR-3105",
    },
    {
        "destination": "Aftermarket Hub",
        "dock": "Dock 2",
        "line_id": "press-01",
        "contents": "P-900 rotor assemblies",
        "trailer": "TR-1802",
    },
    {
        "destination": "Marine Service Depot",
        "dock": "Dock 9",
        "line_id": "coating-06",
        "contents": "Marine panel kits",
        "trailer": "TR-4520",
    },
    {
        "destination": "Reman Return Center",
        "dock": "Dock 4",
        "line_id": "reman-10",
        "contents": "Refurb kits",
        "trailer": "TR-2991",
    },
]

for idx in range(18):
    template = _OUTBOUND_TEMPLATES[idx % len(_OUTBOUND_TEMPLATES)]
    status_cycle = ["Staged", "Loading", "Departed"]
    status = status_cycle[idx % len(status_cycle)]
    OUTBOUND_SHIPMENTS.append(
        {
            "id": uuid.uuid4().hex,
            "reference": _reference("OUT"),
            "destination": template["destination"],
            "dock": template["dock"],
            "status": status,
            "departing_at": _minutes_from_now(12 + (idx % 6) * 10),
            "line_id": template["line_id"],
            "contents": template["contents"],
            "trailer": template["trailer"],
            "logged_at": _minutes_ago(idx * 7 + 5),
        }
    )


def _inventory_status(days_cover: float) -> str:
    if days_cover < 1.5:
        return "Critical"
    if days_cover < 2.5:
        return "Watch"
    return "Healthy"


INVENTORY_POSITIONS: list[Dict[str, Any]] = [
    {
        "id": uuid.uuid4().hex,
        "material": "Billet AA-6061",
        "line_id": "press-01",
        "on_hand": 18600,
        "uom": "kg",
        "daily_usage": 7200,
        "days_cover": 2.6,
        "target_days": 2.5,
        "status": _inventory_status(2.6),
        "last_updated": _iso_now(),
    },
    {
        "id": uuid.uuid4().hex,
        "material": "Pump bodies",
        "line_id": "assembly-02",
        "on_hand": 420,
        "uom": "units",
        "daily_usage": 180,
        "days_cover": 2.3,
        "target_days": 2.0,
        "status": _inventory_status(2.3),
        "last_updated": _iso_now(),
    },
    {
        "id": uuid.uuid4().hex,
        "material": "Carton stock",
        "line_id": "packout-05",
        "on_hand": 9500,
        "uom": "sheets",
        "daily_usage": 3600,
        "days_cover": 2.6,
        "target_days": 2.5,
        "status": _inventory_status(2.6),
        "last_updated": _iso_now(),
    },
]

_INVENTORY_ADDITIONS = [
    {
        "material": "Pump bodies",
        "line_id": "assembly-02",
        "on_hand": 520,
        "uom": "units",
        "daily_usage": 180,
        "target_days": 2.2,
        "minutes_ago": 12,
    },
    {
        "material": "Tool steel blanks",
        "line_id": "machining-03",
        "on_hand": 640,
        "uom": "bars",
        "daily_usage": 210,
        "target_days": 2.8,
        "minutes_ago": 26,
    },
    {
        "material": "Weld wire ER70S",
        "line_id": "welding-04",
        "on_hand": 420,
        "uom": "spools",
        "daily_usage": 150,
        "target_days": 2.0,
        "minutes_ago": 18,
    },
    {
        "material": "Panel hardware kits",
        "line_id": "coating-06",
        "on_hand": 360,
        "uom": "kits",
        "daily_usage": 140,
        "target_days": 2.4,
        "minutes_ago": 33,
    },
    {
        "material": "Chassis rail plate",
        "line_id": "fabrication-07",
        "on_hand": 16200,
        "uom": "kg",
        "daily_usage": 6400,
        "target_days": 2.4,
        "minutes_ago": 20,
    },
    {
        "material": "Reservoir resin",
        "line_id": "molding-08",
        "on_hand": 3400,
        "uom": "kg",
        "daily_usage": 1250,
        "target_days": 2.7,
        "minutes_ago": 9,
    },
    {
        "material": "Vent filter media",
        "line_id": "molding-08",
        "on_hand": 260,
        "uom": "reels",
        "daily_usage": 80,
        "target_days": 3.0,
        "minutes_ago": 45,
    },
    {
        "material": "Pump seal kits",
        "line_id": "assembly-02",
        "on_hand": 860,
        "uom": "kits",
        "daily_usage": 320,
        "target_days": 2.4,
        "minutes_ago": 17,
    },
    {
        "material": "QA sample valves",
        "line_id": "testing-09",
        "on_hand": 140,
        "uom": "units",
        "daily_usage": 45,
        "target_days": 3.1,
        "minutes_ago": 52,
    },
    {
        "material": "Return kit cores",
        "line_id": "reman-10",
        "on_hand": 460,
        "uom": "units",
        "daily_usage": 180,
        "target_days": 2.5,
        "minutes_ago": 30,
    },
    {
        "material": "Grease cartridges",
        "line_id": "press-01",
        "on_hand": 280,
        "uom": "cases",
        "daily_usage": 90,
        "target_days": 3.0,
        "minutes_ago": 40,
    },
    {
        "material": "Safety gloves",
        "line_id": "",
        "on_hand": 840,
        "uom": "boxes",
        "daily_usage": 260,
        "target_days": 3.2,
        "minutes_ago": 22,
    },
]

for blueprint in _INVENTORY_ADDITIONS:
    usage = max(float(blueprint["daily_usage"]), 1.0)
    days_cover = round(float(blueprint["on_hand"]) / usage, 1)
    INVENTORY_POSITIONS.append(
        {
            "id": uuid.uuid4().hex,
            "material": blueprint["material"],
            "line_id": blueprint["line_id"],
            "on_hand": blueprint["on_hand"],
            "uom": blueprint["uom"],
            "daily_usage": blueprint["daily_usage"],
            "days_cover": days_cover,
            "target_days": blueprint["target_days"],
            "status": _inventory_status(days_cover),
            "last_updated": _minutes_ago(blueprint["minutes_ago"]),
        }
    )

SAFETY_INCIDENTS: list[Dict[str, Any]] = [
    {
        "id": uuid.uuid4().hex,
        "line_id": "press-01",
        "area": "Press 01",
        "severity": "Near miss",
        "description": "Guard door interlock defeated during changeover",
        "status": "Open",
        "corrective_action": "Re-trained crew and re-enabled interlock",
        "logged_at": (_dt.datetime.now(_dt.UTC) - _dt.timedelta(hours=3)).isoformat(),
    }
]

_SAFETY_INCIDENT_ADDITIONS = [
    {
        "line_id": "machining-03",
        "area": "CNC Cell 03",
        "severity": "Recordable",
        "description": "Operator pinch during tool swap",
        "status": "Open",
        "corrective_action": "Engineering updating LOTO",
        "minutes_ago": 260,
    },
    {
        "line_id": "welding-04",
        "area": "Robotic Weld 04",
        "severity": "First aid",
        "description": "Sparks through sleeve",
        "status": "Closed",
        "corrective_action": "Issued new PPE",
        "minutes_ago": 95,
    },
    {
        "line_id": "fabrication-07",
        "area": "Laser bay",
        "severity": "Near miss",
        "description": "Lift assist not latched",
        "status": "Open",
        "corrective_action": "Audit assist usage",
        "minutes_ago": 210,
    },
    {
        "line_id": "coating-06",
        "area": "Powder booth",
        "severity": "Near miss",
        "description": "Slip on overspray",
        "status": "Closed",
        "corrective_action": "Improved housekeeping",
        "minutes_ago": 320,
    },
    {
        "line_id": "molding-08",
        "area": "Material mezz",
        "severity": "Near miss",
        "description": "Hopper ladder unsecured",
        "status": "Open",
        "corrective_action": "Install tie-off",
        "minutes_ago": 140,
    },
    {
        "line_id": "assembly-02",
        "area": "Torque station",
        "severity": "Near miss",
        "description": "Loose cord near aisle",
        "status": "Closed",
        "corrective_action": "Cable trays installed",
        "minutes_ago": 88,
    },
    {
        "line_id": "packout-05",
        "area": "Stretch wrapper",
        "severity": "First aid",
        "description": "Hand caught on pallet",
        "status": "Open",
        "corrective_action": "Add guarding",
        "minutes_ago": 62,
    },
    {
        "line_id": "testing-09",
        "area": "Endurance lab",
        "severity": "Near miss",
        "description": "Trip hazard from hose",
        "status": "Open",
        "corrective_action": "Re-route utilities",
        "minutes_ago": 44,
    },
    {
        "line_id": "reman-10",
        "area": "Core teardown",
        "severity": "Near miss",
        "description": "Oil spill near bench",
        "status": "Closed",
        "corrective_action": "Spill kit deployed",
        "minutes_ago": 186,
    },
    {
        "line_id": "",
        "area": "Shipping dock",
        "severity": "Near miss",
        "description": "Forklift and pedestrian conflict",
        "status": "Open",
        "corrective_action": "Paint new walkway",
        "minutes_ago": 70,
    },
    {
        "line_id": "",
        "area": "Cafeteria",
        "severity": "First aid",
        "description": "Slip from spill",
        "status": "Closed",
        "corrective_action": "Add mats",
        "minutes_ago": 310,
    },
]

for blueprint in _SAFETY_INCIDENT_ADDITIONS:
    SAFETY_INCIDENTS.append(
        {
            "id": uuid.uuid4().hex,
            "line_id": blueprint["line_id"],
            "area": blueprint["area"],
            "severity": blueprint["severity"],
            "description": blueprint["description"],
            "status": blueprint["status"],
            "corrective_action": blueprint["corrective_action"],
            "logged_at": _minutes_ago(blueprint["minutes_ago"]),
        }
    )

SAFETY_WALKS: list[Dict[str, Any]] = [
    {
        "id": uuid.uuid4().hex,
        "observer": "EHS: D. Morales",
        "area": "Assembly mezzanine",
        "notes": "No findings; team wearing PPE",
        "follow_up": "None",
        "logged_at": (_dt.datetime.now(_dt.UTC) - _dt.timedelta(hours=1, minutes=20)).isoformat(),
    },
    {
        "id": uuid.uuid4().hex,
        "observer": "Supervisor: L. Ahmed",
        "area": "Packout 05",
        "notes": "Restocked spill kit near load station",
        "follow_up": "Verify absorbents after night shift",
        "logged_at": (_dt.datetime.now(_dt.UTC) - _dt.timedelta(minutes=25)).isoformat(),
    },
]

_SAFETY_WALK_ADDITIONS = [
    {
        "observer": "EHS: M. Cortez",
        "area": "Press pit",
        "notes": "Guarding inspection complete",
        "follow_up": "Schedule quarterly review",
        "minutes_ago": 140,
    },
    {
        "observer": "Supervisor: J. Patel",
        "area": "Laser bay",
        "notes": "Added signage for eye protection",
        "follow_up": "Order replacement decals",
        "minutes_ago": 210,
    },
    {
        "observer": "EHS: K. Miller",
        "area": "Coating booth",
        "notes": "Housekeeping improving, no slips",
        "follow_up": "Audit drains next week",
        "minutes_ago": 95,
    },
    {
        "observer": "Supervisor: H. Lin",
        "area": "Injection molding",
        "notes": "Reviewed lockout steps with crew",
        "follow_up": "Post translated signage",
        "minutes_ago": 60,
    },
    {
        "observer": "EHS: P. Ramos",
        "area": "Testing lab",
        "notes": "Hoses organized on reels",
        "follow_up": "Inspect again Friday",
        "minutes_ago": 32,
    },
    {
        "observer": "Supervisor: R. Ellis",
        "area": "Reman cell",
        "notes": "Core bins labeled, aisles clear",
        "follow_up": "Add lighting over bench",
        "minutes_ago": 180,
    },
    {
        "observer": "EHS: C. Vaughn",
        "area": "Shipping dock",
        "notes": "Pedestrian lanes coned off",
        "follow_up": "Paint permanent markings",
        "minutes_ago": 48,
    },
    {
        "observer": "Supervisor: B. Singh",
        "area": "Tool room",
        "notes": "Shadow boards reorganized",
        "follow_up": "Audit consumables",
        "minutes_ago": 118,
    },
    {
        "observer": "EHS: R. Owen",
        "area": "Cafeteria",
        "notes": "Wet floor signs in use",
        "follow_up": "Replace worn mats",
        "minutes_ago": 200,
    },
    {
        "observer": "Supervisor: J. Torres",
        "area": "Maintenance shop",
        "notes": "Tool carts locked and tagged",
        "follow_up": "Verify calibration station",
        "minutes_ago": 15,
    },
]

for blueprint in _SAFETY_WALK_ADDITIONS:
    SAFETY_WALKS.append(
        {
            "id": uuid.uuid4().hex,
            "observer": blueprint["observer"],
            "area": blueprint["area"],
            "notes": blueprint["notes"],
            "follow_up": blueprint["follow_up"],
            "logged_at": _minutes_ago(blueprint["minutes_ago"]),
        }
    )

TRAINING_COMPLIANCE: Dict[str, Any] = {
    "lockout_tagout": 94.0,
    "ppe": 99.0,
    "forklift": 87.0,
    "audits_due": 1,
    "last_updated": _iso_now(),
}

MAX_SUPPLY_RUNS = 120
MAX_SHIPMENTS = 120
MAX_SAFETY_INCIDENTS = 120
MAX_SAFETY_WALKS = 120

MAX_PAGE_SIZE = 50

PAGINATED_SECTIONS: Dict[str, Dict[str, int]] = {
    "recent_defects": {"default_size": 12},
    "downtime_events": {"default_size": 10},
    "quality_audits": {"default_size": 12},
    "maintenance_backlog": {"default_size": 12},
    "shift_notes": {"default_size": 10},
    "supply_runs": {"default_size": 12},
    "outbound_shipments": {"default_size": 12},
    "inventory_positions": {"default_size": 15},
    "safety_incidents": {"default_size": 10},
    "safety_walks": {"default_size": 12},
}


def _parse_positive_int(
    raw_value: str | None,
    *,
    default: int,
    minimum: int = 1,
    maximum: int | None = None,
) -> int:
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return default
    if value < minimum:
        return minimum
    if maximum is not None and value > maximum:
        return maximum
    return value


def _parse_page_size(section: str, args) -> int:
    config = PAGINATED_SECTIONS.get(section, {})
    default_size = config.get("default_size", 10)
    max_size = config.get("max_size", MAX_PAGE_SIZE)
    raw = args.get(f"page_size[{section}]") or args.get(f"{section}_page_size")
    return _parse_positive_int(raw, default=default_size, minimum=1, maximum=max_size)


def _paginate_sequence(sequence, *, section: str, args):
    page_size = _parse_page_size(section, args)
    total = len(sequence)
    total_pages = max(1, math.ceil(total / page_size)) if total else 1
    raw_page = args.get(f"page[{section}]") or args.get(f"{section}_page")
    page = _parse_positive_int(raw_page, default=1, minimum=1, maximum=total_pages)
    start = (page - 1) * page_size
    end = start + page_size
    window = sequence[start:end]
    return {
        "items": window,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


def _serialize_line(line: Dict[str, Any]) -> Dict[str, Any]:
    payload = _deepcopy(line)
    payload.setdefault("status_detail", "")
    payload.setdefault("active_alert", None)
    payload.setdefault("last_stoppage", None)
    return payload


# ---------------------------------------------------------------------------
# SSE infrastructure
# ---------------------------------------------------------------------------


class _Subscriber(queue.Queue):
    def __init__(self, *, audience: str, user: Dict[str, Any]):
        super().__init__()
        self.audience = audience
        self.user_id = user["id"]
        self.role = user.get("role", "")
        self.scopes = _user_scopes(user)
        self.line_access = _user_line_access(user)

    def can_receive(self, visibility: Set[str], *, line_id: str | None, scope: str) -> bool:
        if visibility and not (self.scopes & visibility):
            return False
        if line_id and line_id not in self.line_access:
            return False
        return True


def _ensure_json_serializable(payload: Dict[str, Any]) -> Dict[str, Any]:
    return json.loads(json.dumps(payload))


_subscribers: list[_Subscriber] = []
_subs_lock = threading.Lock()

def _add_subscriber(audience: str, user_id: str | None) -> _Subscriber:
    user = _resolve_user(user_id)
    normalized_audience = audience if audience in LINES or audience == "global" else "global"
    sub = _Subscriber(audience=normalized_audience, user=user)
    with _subs_lock:
        _subscribers.append(sub)
    return sub


def _remove_subscriber(sub: _Subscriber) -> None:
    with _subs_lock:
        try:
            _subscribers.remove(sub)
        except ValueError:
            pass


def _broadcast_update(
    payload: Dict[str, Any],
    *,
    audience: str,
    scope: str,
    visibility: Iterable[str] | None = None,
    line_id: str | None = None,
) -> None:
    visibility_set = _normalize_visibility(visibility)
    message = {
        **_ensure_json_serializable(payload),
        "audience": audience,
        "scope": scope,
        "visibility": sorted(visibility_set),
        "id": payload.get("id", uuid.uuid4().hex),
        "ts": payload.get("ts", _iso_now()),
    }
    line_context = line_id or (audience if audience in LINES else None)
    if line_context and "line_id" not in message:
        message["line_id"] = line_context
    with _subs_lock:
        targets = [sub for sub in _subscribers if sub.audience == audience]
    for sub in targets:
        if not sub.can_receive(visibility_set, line_id=line_context, scope=scope):
            continue
        try:
            sub.put_nowait(message)
        except queue.Full:
            pass


def _event_stream(sub: _Subscriber):
    try:
        ready = {
            "type": "ready",
            "audience": sub.audience,
            "user": sub.user_id,
            "role": sub.role,
            "scopes": sorted(sub.scopes),
        }
        yield f"data: {json.dumps(ready)}\n\n"
        while True:
            try:
                payload = sub.get(timeout=25)
            except queue.Empty:
                yield ": keep-alive\n\n"
                continue
            yield f"data: {json.dumps(payload)}\n\n"
    finally:
        _remove_subscriber(sub)


# ---------------------------------------------------------------------------
# Mutators
# ---------------------------------------------------------------------------


def _append_limited(collection: list[Dict[str, Any]], entry: Dict[str, Any], limit: int) -> None:
    collection.insert(0, entry)
    del collection[limit:]


def _upsert_line(line: Dict[str, Any]) -> Dict[str, Any]:
    stored = LINES[line["id"]]
    stored.update(line)
    stored["last_updated"] = _iso_now()
    return stored


def log_stoppage(line_id: str, reason: str, expected_minutes: int, reported_by: str) -> Dict[str, Any]:
    with DATA_LOCK:
        line = LINES.get(line_id)
        if not line:
            raise KeyError(f"Unknown line: {line_id}")
        event = {
            "id": uuid.uuid4().hex,
            "line_id": line_id,
            "reason": reason,
            "reported_by": reported_by,
            "started_at": _iso_now(),
            "expected_resolution": _minutes_from_now(expected_minutes),
            "status": "Pending Response",
        }
        line.update(
            {
                "status": "Stopped",
                "status_detail": reason,
                "active_alert": {
                    "type": "downtime",
                    "reason": reason,
                    "reported_by": reported_by,
                    "expected_resolution": event["expected_resolution"],
                },
                "last_stoppage": event,
                "last_updated": _iso_now(),
            }
        )
        _append_limited(DOWNTIME_EVENTS, event, MAX_DOWNTIME)
        serialized_line = _serialize_line(line)
    update = {
        "type": "downtime_event",
        "event": event,
        "line": serialized_line,
        "message": f"{line['name']} stopped: {reason}",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"maintenance"},
        line_id=line_id,
    )
    _broadcast_update(
        update,
        audience=line_id,
        scope="line",
        visibility={"maintenance"},
        line_id=line_id,
    )
    return update


def resolve_line(line_id: str, note: str | None = None) -> Dict[str, Any]:
    with DATA_LOCK:
        line = LINES.get(line_id)
        if not line:
            raise KeyError(f"Unknown line: {line_id}")
        line.update(
            {
                "status": "Running",
                "status_detail": note or "Running to plan",
                "active_alert": None,
                "last_updated": _iso_now(),
            }
        )
        serialized_line = _serialize_line(line)
    update = {
        "type": "line_recovered",
        "line": serialized_line,
        "message": f"{line['name']} resumed production",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"maintenance"},
        line_id=line_id,
    )
    _broadcast_update(
        update,
        audience=line_id,
        scope="line",
        visibility={"maintenance"},
        line_id=line_id,
    )
    return update


def record_defect(line_id: str, sku: str, description: str, severity: str) -> Dict[str, Any]:
    with DATA_LOCK:
        line = LINES.get(line_id)
        if not line:
            raise KeyError(f"Unknown line: {line_id}")
        entry = {
            "id": uuid.uuid4().hex,
            "line_id": line_id,
            "sku": sku,
            "description": description,
            "severity": severity,
            "detected_at": _iso_now(),
            "containment": "Operator hold + QA audit",
        }
        _append_limited(RECENT_DEFECTS, entry, MAX_DEFECTS)
        serialized_line = _serialize_line(line)
    update = {
        "type": "quality_alert",
        "line": serialized_line,
        "defect": entry,
        "message": f"Defect logged on {sku} ({line['name']})",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"quality"},
        line_id=line_id,
    )
    _broadcast_update(
        update,
        audience=line_id,
        scope="line",
        visibility={"quality"},
        line_id=line_id,
    )
    return update


def record_quality_audit(
    line_id: str | None,
    sku: str,
    summary: str,
    performed_by: str,
    status: str,
) -> Dict[str, Any]:
    with DATA_LOCK:
        line = LINES.get(line_id) if line_id else None
        audit = {
            "id": uuid.uuid4().hex,
            "line_id": line_id,
            "sku": sku,
            "performed_by": performed_by,
            "summary": summary,
            "logged_at": _iso_now(),
            "status": status,
        }
        _append_limited(QUALITY_AUDITS, audit, MAX_AUDITS)
        QUALITY_SUMMARY["containment_actions"] = QUALITY_SUMMARY.get("containment_actions", 0) + 1
        QUALITY_SUMMARY["last_updated"] = _iso_now()
        serialized_line = _serialize_line(line) if line else None
        summary_snapshot = _deepcopy(QUALITY_SUMMARY)
    update = {
        "type": "quality_audit",
        "line": serialized_line,
        "audit": audit,
        "summary": summary_snapshot,
        "message": f"QA audit logged for {sku} by {performed_by}",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"quality"},
        line_id=line_id,
    )
    if line_id:
        _broadcast_update(
            update,
            audience=line_id,
            scope="line",
            visibility={"quality"},
            line_id=line_id,
        )
    return update


def update_line_plan(
    line_id: str,
    *,
    status: str | None = None,
    crew_lead: str | None = None,
    line_goal_units: int | None = None,
    oee: float | None = None,
    active_sku: str | None = None,
    status_detail: str | None = None,
) -> Dict[str, Any]:
    with DATA_LOCK:
        line = LINES.get(line_id)
        if not line:
            raise KeyError(f"Unknown line: {line_id}")
        updates: Dict[str, Any] = {}
        changes: list[str] = []
        if status:
            updates["status"] = status
            changes.append(f"status → {status}")
        if crew_lead:
            updates["crew_lead"] = crew_lead
            changes.append(f"crew lead → {crew_lead}")
        if line_goal_units is not None:
            safe_goal = max(int(line_goal_units), 1)
            updates["line_goal_units"] = safe_goal
            changes.append(f"goal {safe_goal} units")
        if oee is not None:
            safe_oee = max(min(float(oee), 100.0), 0.0)
            rounded_oee = round(safe_oee, 1)
            updates["oee"] = rounded_oee
            changes.append(f"OEE {rounded_oee}%")
        if active_sku:
            updates["active_sku"] = active_sku
            changes.append(f"SKU → {active_sku}")
        if status_detail is not None:
            updates["status_detail"] = status_detail or "Running to plan"
            if status_detail:
                changes.append("status detail updated")
        if not updates:
            raise ValueError("No updates provided for line")
        line.update(updates)
        if updates.get("status") == "Running" and not updates.get("status_detail"):
            line.setdefault("status_detail", "Running to plan")
        line["last_updated"] = _iso_now()
        serialized_line = _serialize_line(line)
    message_changes = ", ".join(changes) if changes else "plan refreshed"
    update = {
        "type": "line_plan_update",
        "line": serialized_line,
        "message": f"{serialized_line['name']} plan updated ({message_changes})",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"overview"},
        line_id=line_id,
    )
    _broadcast_update(
        update,
        audience=line_id,
        scope="line",
        visibility={"overview"},
        line_id=line_id,
    )
    return update


def update_line_sku(
    line_id: str,
    sku_code: str,
    *,
    shift_output: int | None = None,
    quality_yield: float | None = None,
    queued_orders: int | None = None,
) -> Dict[str, Any]:
    with DATA_LOCK:
        line = LINES.get(line_id)
        if not line:
            raise KeyError(f"Unknown line: {line_id}")
        sku = next((entry for entry in line.get("skus", []) if entry["sku"] == sku_code), None)
        if not sku:
            raise KeyError(f"Unknown SKU '{sku_code}' on line '{line_id}'")
        changes: list[str] = []
        if shift_output is not None:
            safe_output = max(int(shift_output), 0)
            sku["shift_output"] = safe_output
            changes.append(f"shift output {safe_output}")
        if quality_yield is not None:
            safe_yield = max(min(float(quality_yield), 100.0), 0.0)
            rounded_yield = round(safe_yield, 1)
            sku["quality_yield"] = rounded_yield
            changes.append(f"yield {rounded_yield}%")
        if queued_orders is not None:
            safe_queue = max(int(queued_orders), 0)
            sku["queued_orders"] = safe_queue
            changes.append(f"orders {safe_queue}")
        if not changes:
            raise ValueError("No SKU adjustments provided")
        line["last_updated"] = _iso_now()
        serialized_line = _serialize_line(line)
        sku_snapshot = _deepcopy(sku)
    update = {
        "type": "sku_adjustment",
        "line": serialized_line,
        "sku": sku_snapshot,
        "message": f"{serialized_line['name']} SKU {sku_code} tuned ({', '.join(changes)})",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"overview"},
        line_id=line_id,
    )
    _broadcast_update(
        update,
        audience=line_id,
        scope="line",
        visibility={"overview"},
        line_id=line_id,
    )
    return update


def dispatch_maintenance(
    event_id: str,
    technician: str,
    eta_minutes: int,
    note: str | None = None,
) -> Dict[str, Any]:
    with DATA_LOCK:
        event = next((item for item in DOWNTIME_EVENTS if item["id"] == event_id), None)
        if not event:
            raise KeyError(f"Unknown downtime event: {event_id}")
        line = LINES.get(event["line_id"])
        if not line:
            raise KeyError(f"Unknown line: {event['line_id']}")
        event.update(
            {
                "status": "Dispatched",
                "assigned_to": technician,
                "dispatch_note": note or "",
                "dispatched_at": _iso_now(),
                "expected_resolution": _minutes_from_now(eta_minutes),
            }
        )
        serialized_line = _serialize_line(line)
    update = {
        "type": "maintenance_dispatch",
        "event": event,
        "line": serialized_line,
        "message": f"{technician} dispatched to {line['name']} stoppage",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"maintenance"},
        line_id=line["id"],
    )
    _broadcast_update(
        update,
        audience=line["id"],
        scope="line",
        visibility={"maintenance"},
        line_id=line["id"],
    )
    return update


def add_shift_note(author: str, focus: str, note: str) -> Dict[str, Any]:
    with DATA_LOCK:
        entry = {
            "id": uuid.uuid4().hex,
            "shift": _shift_from_now(),
            "author": author,
            "focus": focus,
            "note": note,
            "logged_at": _iso_now(),
        }
        _append_limited(SHIFT_NOTES, entry, MAX_SHIFT_NOTES)
    update = {
        "type": "shift_note",
        "note": entry,
        "message": f"Handover note posted by {author}",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"handover"},
    )
    return update


def log_supply_arrival(
    *,
    line_id: str | None,
    dock: str,
    carrier: str,
    material: str,
    quantity: int,
    uom: str,
    eta_minutes: int,
    notes: str | None = None,
) -> Dict[str, Any]:
    with DATA_LOCK:
        line = LINES.get(line_id) if line_id else None
        reference = _reference("INB")
        delivery = {
            "id": uuid.uuid4().hex,
            "reference": reference,
            "carrier": carrier,
            "dock": dock,
            "status": "Checked In",
            "eta": _minutes_from_now(max(eta_minutes, 1)),
            "line_id": line_id,
            "material": material,
            "quantity": quantity,
            "uom": uom,
            "notes": notes or "",
            "logged_at": _iso_now(),
        }
        _append_limited(SUPPLY_RUNS, delivery, MAX_SUPPLY_RUNS)
        inventory_snapshot = None
        if material:
            lowered = material.lower()
            item = next((entry for entry in INVENTORY_POSITIONS if entry["material"].lower() == lowered), None)
            if item:
                item["on_hand"] += quantity
                usage = max(item.get("daily_usage", 1), 1)
                item["days_cover"] = round(item["on_hand"] / usage, 1)
                item["status"] = _inventory_status(item["days_cover"])
                item["last_updated"] = _iso_now()
                item.setdefault("target_days", 2.5)
            else:
                inferred_usage = max(int(quantity * 0.4), 1)
                inferred_days = round(quantity / inferred_usage, 1)
                INVENTORY_POSITIONS.insert(
                    0,
                    {
                        "id": uuid.uuid4().hex,
                        "material": material,
                        "line_id": line_id or "",
                        "on_hand": quantity,
                        "uom": uom,
                        "daily_usage": inferred_usage,
                        "days_cover": inferred_days,
                        "target_days": max(inferred_days, 2.0),
                        "status": _inventory_status(inferred_days),
                        "last_updated": _iso_now(),
                    },
                )
            inventory_snapshot = _deepcopy(INVENTORY_POSITIONS)
        serialized_line = _serialize_line(line) if line else None
    message = f"{carrier} checked in at {dock} with {material}"
    if serialized_line:
        message = f"{serialized_line['name']} material received at {dock}"
    update: Dict[str, Any] = {
        "type": "supply_run",
        "delivery": delivery,
        "inventory": inventory_snapshot,
        "line": serialized_line,
        "message": message,
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"logistics"},
        line_id=line_id,
    )
    if line_id:
        _broadcast_update(
            update,
            audience=line_id,
            scope="line",
            visibility={"logistics"},
            line_id=line_id,
        )
    return update


def adjust_inventory_position(
    inventory_id: str,
    *,
    on_hand: int | None = None,
    daily_usage: float | None = None,
    target_days: float | None = None,
) -> Dict[str, Any]:
    with DATA_LOCK:
        item = next((entry for entry in INVENTORY_POSITIONS if entry["id"] == inventory_id), None)
        if not item:
            raise KeyError(f"Unknown inventory id: {inventory_id}")
        changes: list[str] = []
        if on_hand is not None:
            safe_on_hand = max(int(on_hand), 0)
            item["on_hand"] = safe_on_hand
            changes.append(f"on hand {safe_on_hand}")
        if daily_usage is not None:
            safe_usage = max(float(daily_usage), 0.1)
            item["daily_usage"] = round(safe_usage, 1)
            changes.append(f"usage {round(safe_usage, 1)}")
        if target_days is not None:
            safe_target = max(float(target_days), 0.5)
            item["target_days"] = round(safe_target, 1)
            changes.append(f"target {round(safe_target, 1)}d")
        if not changes:
            raise ValueError("No inventory adjustments provided")
        usage = max(float(item.get("daily_usage", 1.0)), 0.1)
        item["days_cover"] = round(float(item.get("on_hand", 0)) / usage, 1)
        item["status"] = _inventory_status(item["days_cover"])
        item["last_updated"] = _iso_now()
        inventory_snapshot = _deepcopy(INVENTORY_POSITIONS)
        item_snapshot = _deepcopy(item)
    update = {
        "type": "inventory_adjustment",
        "inventory_item": item_snapshot,
        "inventory": inventory_snapshot,
        "message": f"Inventory tuned for {item_snapshot['material']} ({'; '.join(changes)})",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"logistics"},
        line_id=item_snapshot.get("line_id"),
    )
    return update


def schedule_shipment(
    *,
    line_id: str | None,
    destination: str,
    dock: str,
    trailer: str,
    contents: str,
    departure_minutes: int,
) -> Dict[str, Any]:
    with DATA_LOCK:
        line = LINES.get(line_id) if line_id else None
        reference = _reference("OUT")
        shipment = {
            "id": uuid.uuid4().hex,
            "reference": reference,
            "destination": destination,
            "dock": dock,
            "status": "Staged",
            "departing_at": _minutes_from_now(max(departure_minutes, 1)),
            "line_id": line_id,
            "contents": contents,
            "trailer": trailer,
            "logged_at": _iso_now(),
        }
        _append_limited(OUTBOUND_SHIPMENTS, shipment, MAX_SHIPMENTS)
        serialized_line = _serialize_line(line) if line else None
    message = f"Shipment {reference} staged for {destination}"
    if serialized_line:
        message = f"{serialized_line['name']} order staged for {destination}"
    update: Dict[str, Any] = {
        "type": "shipment_update",
        "shipment": shipment,
        "line": serialized_line,
        "message": message,
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"logistics"},
        line_id=line_id,
    )
    if line_id:
        _broadcast_update(
            update,
            audience=line_id,
            scope="line",
            visibility={"logistics"},
            line_id=line_id,
        )
    return update


def update_shipment_status(
    shipment_id: str,
    *,
    status: str | None = None,
    departure_minutes: int | None = None,
) -> Dict[str, Any]:
    with DATA_LOCK:
        shipment = next((entry for entry in OUTBOUND_SHIPMENTS if entry["id"] == shipment_id), None)
        if not shipment:
            raise KeyError(f"Unknown shipment id: {shipment_id}")
        changes: list[str] = []
        if status:
            shipment["status"] = status
            changes.append(f"status → {status}")
        if departure_minutes is not None:
            shipment["departing_at"] = _minutes_from_now(max(int(departure_minutes), 0))
            changes.append(f"departing in {max(int(departure_minutes), 0)}m")
        if not changes:
            raise ValueError("No shipment updates provided")
        shipment["logged_at"] = _iso_now()
        shipment_snapshot = _deepcopy(shipment)
        line = LINES.get(shipment.get("line_id")) if shipment.get("line_id") else None
        serialized_line = _serialize_line(line) if line else None
    update = {
        "type": "shipment_update",
        "shipment": shipment_snapshot,
        "line": serialized_line,
        "message": f"Shipment {shipment_snapshot['reference']} updated ({', '.join(changes)})",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"logistics"},
        line_id=shipment_snapshot.get("line_id"),
    )
    if shipment.get("line_id"):
        _broadcast_update(
            update,
            audience=shipment["line_id"],
            scope="line",
            visibility={"logistics"},
            line_id=shipment["line_id"],
        )
    return update


def record_safety_incident(
    *,
    line_id: str | None,
    area: str,
    severity: str,
    description: str,
    corrective_action: str,
) -> Dict[str, Any]:
    with DATA_LOCK:
        incident = {
            "id": uuid.uuid4().hex,
            "line_id": line_id,
            "area": area,
            "severity": severity,
            "description": description,
            "status": "Open",
            "corrective_action": corrective_action,
            "logged_at": _iso_now(),
        }
        _append_limited(SAFETY_INCIDENTS, incident, MAX_SAFETY_INCIDENTS)
        TRAINING_COMPLIANCE["audits_due"] = TRAINING_COMPLIANCE.get("audits_due", 0) + 1
        TRAINING_COMPLIANCE["last_updated"] = _iso_now()
        line = LINES.get(line_id) if line_id else None
        serialized_line = _serialize_line(line) if line else None
        training_snapshot = _deepcopy(TRAINING_COMPLIANCE)
    update: Dict[str, Any] = {
        "type": "safety_incident",
        "incident": incident,
        "training": training_snapshot,
        "line": serialized_line,
        "message": f"Safety incident logged in {area} ({severity})",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"safety"},
        line_id=line_id,
    )
    if line_id:
        _broadcast_update(
            update,
            audience=line_id,
            scope="line",
            visibility={"safety"},
            line_id=line_id,
        )
    return update


def update_safety_incident(
    incident_id: str,
    *,
    status: str | None = None,
    corrective_action: str | None = None,
) -> Dict[str, Any]:
    with DATA_LOCK:
        incident = next((entry for entry in SAFETY_INCIDENTS if entry["id"] == incident_id), None)
        if not incident:
            raise KeyError(f"Unknown safety incident: {incident_id}")
        changes: list[str] = []
        if status:
            incident["status"] = status
            changes.append(f"status → {status}")
            if status.lower() == "closed":
                incident["closed_at"] = _iso_now()
        if corrective_action is not None:
            incident["corrective_action"] = corrective_action
            if corrective_action:
                changes.append("action updated")
        if not changes:
            raise ValueError("No safety updates provided")
        incident["updated_at"] = _iso_now()
        training_snapshot = None
        if status and status.lower() == "closed":
            if TRAINING_COMPLIANCE.get("audits_due", 0) > 0:
                TRAINING_COMPLIANCE["audits_due"] -= 1
            TRAINING_COMPLIANCE["last_updated"] = _iso_now()
            training_snapshot = _deepcopy(TRAINING_COMPLIANCE)
        line = LINES.get(incident.get("line_id")) if incident.get("line_id") else None
        serialized_line = _serialize_line(line) if line else None
        incident_snapshot = _deepcopy(incident)
    update = {
        "type": "safety_incident",
        "incident": incident_snapshot,
        "training": training_snapshot,
        "line": serialized_line,
        "message": f"Safety log updated for {incident_snapshot['area']} ({'; '.join(changes)})",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"safety"},
        line_id=incident_snapshot.get("line_id"),
    )
    if incident_snapshot.get("line_id"):
        _broadcast_update(
            update,
            audience=incident_snapshot["line_id"],
            scope="line",
            visibility={"safety"},
            line_id=incident_snapshot["line_id"],
        )
    return update


def record_safety_walk(
    *,
    observer: str,
    area: str,
    notes: str,
    follow_up: str,
) -> Dict[str, Any]:
    with DATA_LOCK:
        walk = {
            "id": uuid.uuid4().hex,
            "observer": observer,
            "area": area,
            "notes": notes,
            "follow_up": follow_up,
            "logged_at": _iso_now(),
        }
        _append_limited(SAFETY_WALKS, walk, MAX_SAFETY_WALKS)
        if TRAINING_COMPLIANCE.get("audits_due", 0) > 0:
            TRAINING_COMPLIANCE["audits_due"] -= 1
        TRAINING_COMPLIANCE["last_updated"] = _iso_now()
        training_snapshot = _deepcopy(TRAINING_COMPLIANCE)
    update: Dict[str, Any] = {
        "type": "safety_walk",
        "walk": walk,
        "training": training_snapshot,
        "message": f"Safety walk completed in {area} by {observer}",
    }
    _broadcast_update(
        update,
        audience="global",
        scope="global",
        visibility={"safety"},
    )
    return update


def _shift_from_now() -> str:
    hour = _dt.datetime.now(_dt.UTC).hour
    if 6 <= hour < 14:
        return "A"
    if 14 <= hour < 22:
        return "B"
    return "C"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/")
def index() -> str:
    return render_template("index.html", user_directory=_export_user_directory())


@app.get("/api/dashboard")
def dashboard() -> Response:
    args = request.args
    user = _resolve_user(args.get("user"))
    with DATA_LOCK:
        lines = [_serialize_line(line) for line in LINES.values()]
        defects = _deepcopy(RECENT_DEFECTS)
        downtime = _deepcopy(DOWNTIME_EVENTS)
        quality_summary = _deepcopy(QUALITY_SUMMARY)
        quality_audits = _deepcopy(QUALITY_AUDITS)
        maintenance_backlog = _deepcopy(MAINTENANCE_BACKLOG)
        shift_notes = _deepcopy(SHIFT_NOTES)
        supply_runs = _deepcopy(SUPPLY_RUNS)
        outbound_shipments = _deepcopy(OUTBOUND_SHIPMENTS)
        inventory_positions = _deepcopy(INVENTORY_POSITIONS)
        safety_incidents = _deepcopy(SAFETY_INCIDENTS)
        safety_walks = _deepcopy(SAFETY_WALKS)
        training_compliance = _deepcopy(TRAINING_COMPLIANCE)
    allowed_lines = _user_line_access(user)
    if _user_has_scope(user, "overview"):
        lines = [line for line in lines if line["id"] in allowed_lines]
    else:
        lines = []
    defects = _filter_sequence_by_scope(defects, scope="quality", user=user)
    downtime = _filter_sequence_by_scope(downtime, scope="maintenance", user=user)
    quality_audits = _filter_sequence_by_scope(quality_audits, scope="quality", user=user)
    maintenance_backlog = _filter_sequence_by_scope(
        maintenance_backlog, scope="maintenance", user=user, line_key=None
    )
    shift_notes = _filter_sequence_by_scope(
        shift_notes, scope="handover", user=user, line_key=None
    )
    supply_runs = _filter_sequence_by_scope(supply_runs, scope="logistics", user=user)
    outbound_shipments = _filter_sequence_by_scope(
        outbound_shipments, scope="logistics", user=user
    )
    inventory_positions = _filter_sequence_by_scope(
        inventory_positions, scope="logistics", user=user
    )
    safety_incidents = _filter_sequence_by_scope(
        safety_incidents, scope="safety", user=user
    )
    safety_walks = _filter_sequence_by_scope(
        safety_walks, scope="safety", user=user, line_key=None
    )
    paginated_payload = {
        "recent_defects": _paginate_sequence(defects, section="recent_defects", args=args),
        "downtime_events": _paginate_sequence(downtime, section="downtime_events", args=args),
        "quality_audits": _paginate_sequence(quality_audits, section="quality_audits", args=args),
        "maintenance_backlog": _paginate_sequence(
            maintenance_backlog, section="maintenance_backlog", args=args
        ),
        "shift_notes": _paginate_sequence(shift_notes, section="shift_notes", args=args),
        "supply_runs": _paginate_sequence(supply_runs, section="supply_runs", args=args),
        "outbound_shipments": _paginate_sequence(
            outbound_shipments, section="outbound_shipments", args=args
        ),
        "inventory_positions": _paginate_sequence(
            inventory_positions, section="inventory_positions", args=args
        ),
        "safety_incidents": _paginate_sequence(
            safety_incidents, section="safety_incidents", args=args
        ),
        "safety_walks": _paginate_sequence(safety_walks, section="safety_walks", args=args),
    }
    inventory_catalog = (
        sorted({item["material"] for item in inventory_positions if item.get("material")})
        if _user_has_scope(user, "logistics")
        else []
    )
    payload = {
        "lines": lines,
        "quality_summary": quality_summary if _user_has_scope(user, "quality") else None,
        "training_compliance": training_compliance if _user_has_scope(user, "safety") else None,
        "inventory_catalog": inventory_catalog,
        "viewer": {
            "id": user["id"],
            "name": user["name"],
            "role": user.get("role", ""),
            "scopes": sorted(_user_scopes(user)),
            "line_access": sorted(allowed_lines),
        },
    }
    payload.update(paginated_payload)
    return jsonify(payload)


@app.post("/api/log-stoppage")
def api_log_stoppage() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    line_id = payload.get("line_id")
    reason = (payload.get("reason") or "Unspecified stoppage").strip()
    expected = int(payload.get("expected_duration_minutes") or 15)
    reporter = (payload.get("reported_by") or "Operator").strip()
    if not line_id:
        return jsonify({"error": "line_id is required"}), 400
    try:
        update = log_stoppage(line_id, reason, expected, reporter)
    except KeyError:
        return jsonify({"error": f"Unknown line_id '{line_id}'"}), 404
    return jsonify({"ok": True, "update": update})


@app.post("/api/resolve-line")
def api_resolve_line() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    line_id = payload.get("line_id")
    note = payload.get("note")
    if not line_id:
        return jsonify({"error": "line_id is required"}), 400
    try:
        update = resolve_line(line_id, note)
    except KeyError:
        return jsonify({"error": f"Unknown line_id '{line_id}'"}), 404
    return jsonify({"ok": True, "update": update})


@app.post("/api/record-defect")
def api_record_defect() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    line_id = payload.get("line_id")
    sku = payload.get("sku")
    description = (payload.get("description") or "Unspecified defect").strip()
    severity = (payload.get("severity") or "minor").strip()
    if not line_id or not sku:
        return jsonify({"error": "line_id and sku are required"}), 400
    try:
        update = record_defect(line_id, sku, description, severity)
    except KeyError:
        return jsonify({"error": f"Unknown line_id '{line_id}'"}), 404
    return jsonify({"ok": True, "update": update})


@app.post("/api/record-audit")
def api_record_audit() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    sku = (payload.get("sku") or "SKU").strip()
    summary = (payload.get("summary") or "").strip() or "Audit logged"
    performed_by = (payload.get("performed_by") or "QA").strip()
    status = (payload.get("status") or "Open").strip()
    line_id = (payload.get("line_id") or "").strip() or None
    try:
        update = record_quality_audit(line_id, sku, summary, performed_by, status)
    except KeyError as exc:
        return jsonify({"error": str(exc)}), 404
    return jsonify({"ok": True, "update": update})


@app.post("/api/update-line-plan")
def api_update_line_plan() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    line_id = (payload.get("line_id") or "").strip()
    if not line_id:
        return jsonify({"error": "line_id is required"}), 400
    status = (payload.get("status") or "").strip() or None
    crew_lead = (payload.get("crew_lead") or "").strip() or None
    active_sku = (payload.get("active_sku") or "").strip() or None
    status_detail = payload.get("status_detail")
    status_detail = (status_detail.strip() if isinstance(status_detail, str) else status_detail)
    line_goal_units = payload.get("line_goal_units")
    try:
        line_goal_units = int(line_goal_units) if line_goal_units is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "line_goal_units must be numeric"}), 400
    oee = payload.get("oee")
    try:
        oee = float(oee) if oee is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "oee must be numeric"}), 400
    try:
        update = update_line_plan(
            line_id,
            status=status,
            crew_lead=crew_lead,
            line_goal_units=line_goal_units,
            oee=oee,
            active_sku=active_sku,
            status_detail=status_detail,
        )
    except KeyError:
        return jsonify({"error": f"Unknown line_id '{line_id}'"}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True, "update": update})


@app.post("/api/update-line-sku")
def api_update_line_sku() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    line_id = (payload.get("line_id") or "").strip()
    sku_code = (payload.get("sku") or "").strip()
    if not line_id or not sku_code:
        return jsonify({"error": "line_id and sku are required"}), 400
    shift_output = payload.get("shift_output")
    quality_yield = payload.get("quality_yield")
    queued_orders = payload.get("queued_orders")
    try:
        shift_output = int(shift_output) if shift_output is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "shift_output must be numeric"}), 400
    try:
        quality_yield = float(quality_yield) if quality_yield is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "quality_yield must be numeric"}), 400
    try:
        queued_orders = int(queued_orders) if queued_orders is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "queued_orders must be numeric"}), 400
    try:
        update = update_line_sku(
            line_id,
            sku_code,
            shift_output=shift_output,
            quality_yield=quality_yield,
            queued_orders=queued_orders,
        )
    except KeyError as exc:
        return jsonify({"error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True, "update": update})


@app.post("/api/dispatch-maintenance")
def api_dispatch_maintenance() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    event_id = payload.get("event_id")
    technician = (payload.get("technician") or "Maintenance").strip()
    eta_minutes = int(payload.get("eta_minutes") or 15)
    note = (payload.get("note") or "").strip()
    if not event_id:
        return jsonify({"error": "event_id is required"}), 400
    try:
        update = dispatch_maintenance(event_id, technician, eta_minutes, note)
    except KeyError as exc:
        return jsonify({"error": str(exc)}), 404
    return jsonify({"ok": True, "update": update})


@app.post("/api/shift-note")
def api_shift_note() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    author = (payload.get("author") or "Supervisor").strip()
    focus = (payload.get("focus") or "Shift update").strip()
    note = (payload.get("note") or "").strip()
    if not note:
        return jsonify({"error": "note is required"}), 400
    update = add_shift_note(author, focus, note)
    return jsonify({"ok": True, "update": update})


@app.post("/api/log-delivery")
def api_log_delivery() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    line_id = (payload.get("line_id") or "").strip() or None
    dock = (payload.get("dock") or "Dock 1").strip()
    carrier = (payload.get("carrier") or "Carrier").strip()
    material = (payload.get("material") or "Material").strip()
    uom = (payload.get("uom") or "units").strip()
    notes = (payload.get("notes") or "").strip()
    try:
        quantity = int(payload.get("quantity") or 0)
    except (TypeError, ValueError):
        quantity = 0
    quantity = max(quantity, 1)
    try:
        eta_minutes = int(payload.get("eta_minutes") or 15)
    except (TypeError, ValueError):
        eta_minutes = 15
    update = log_supply_arrival(
        line_id=line_id,
        dock=dock,
        carrier=carrier,
        material=material,
        quantity=quantity,
        uom=uom,
        eta_minutes=eta_minutes,
        notes=notes,
    )
    return jsonify({"ok": True, "update": update})


@app.post("/api/adjust-inventory")
def api_adjust_inventory() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    inventory_id = (payload.get("inventory_id") or "").strip()
    if not inventory_id:
        return jsonify({"error": "inventory_id is required"}), 400
    on_hand = payload.get("on_hand")
    daily_usage = payload.get("daily_usage")
    target_days = payload.get("target_days")
    try:
        on_hand = int(on_hand) if on_hand is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "on_hand must be numeric"}), 400
    try:
        daily_usage = float(daily_usage) if daily_usage is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "daily_usage must be numeric"}), 400
    try:
        target_days = float(target_days) if target_days is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "target_days must be numeric"}), 400
    try:
        update = adjust_inventory_position(
            inventory_id,
            on_hand=on_hand,
            daily_usage=daily_usage,
            target_days=target_days,
        )
    except KeyError as exc:
        return jsonify({"error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True, "update": update})


@app.post("/api/log-shipment")
def api_log_shipment() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    line_id = (payload.get("line_id") or "").strip() or None
    destination = (payload.get("destination") or "Customer").strip()
    dock = (payload.get("dock") or "Dock").strip()
    trailer = (payload.get("trailer") or "Trailer").strip()
    contents = (payload.get("contents") or "Shipment").strip()
    try:
        departure_minutes = int(payload.get("departure_minutes") or 30)
    except (TypeError, ValueError):
        departure_minutes = 30
    update = schedule_shipment(
        line_id=line_id,
        destination=destination,
        dock=dock,
        trailer=trailer,
        contents=contents,
        departure_minutes=departure_minutes,
    )
    return jsonify({"ok": True, "update": update})


@app.post("/api/update-shipment")
def api_update_shipment() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    shipment_id = (payload.get("shipment_id") or "").strip()
    if not shipment_id:
        return jsonify({"error": "shipment_id is required"}), 400
    status = (payload.get("status") or "").strip() or None
    departure_minutes = payload.get("departure_minutes")
    try:
        departure_minutes = int(departure_minutes) if departure_minutes is not None else None
    except (TypeError, ValueError):
        return jsonify({"error": "departure_minutes must be numeric"}), 400
    try:
        update = update_shipment_status(
            shipment_id,
            status=status,
            departure_minutes=departure_minutes,
        )
    except KeyError as exc:
        return jsonify({"error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True, "update": update})


@app.post("/api/log-safety-incident")
def api_log_safety_incident() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    line_id = (payload.get("line_id") or "").strip() or None
    area = (payload.get("area") or (line_id or "Plant floor")).strip()
    severity = (payload.get("severity") or "Near miss").strip()
    description = (payload.get("description") or "").strip()
    corrective_action = (payload.get("corrective_action") or "").strip() or "Action recorded"
    if not description:
        return jsonify({"error": "description is required"}), 400
    update = record_safety_incident(
        line_id=line_id,
        area=area,
        severity=severity,
        description=description,
        corrective_action=corrective_action,
    )
    return jsonify({"ok": True, "update": update})


@app.post("/api/update-safety-incident")
def api_update_safety_incident() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    incident_id = (payload.get("incident_id") or "").strip()
    if not incident_id:
        return jsonify({"error": "incident_id is required"}), 400
    status = (payload.get("status") or "").strip() or None
    corrective_action = payload.get("corrective_action")
    corrective_action = (
        corrective_action.strip()
        if isinstance(corrective_action, str)
        else corrective_action
    )
    try:
        update = update_safety_incident(
            incident_id,
            status=status,
            corrective_action=corrective_action,
        )
    except KeyError as exc:
        return jsonify({"error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True, "update": update})


@app.post("/api/log-safety-walk")
def api_log_safety_walk() -> Response:
    payload = request.get_json(force=True, silent=True) or {}
    observer = (payload.get("observer") or "EHS").strip()
    area = (payload.get("area") or "Floor").strip()
    notes = (payload.get("notes") or "").strip()
    follow_up = (payload.get("follow_up") or "").strip()
    if not notes:
        return jsonify({"error": "notes are required"}), 400
    update = record_safety_walk(
        observer=observer,
        area=area,
        notes=notes,
        follow_up=follow_up,
    )
    return jsonify({"ok": True, "update": update})


@app.get("/events")
def sse_events() -> Response:
    audience = request.args.get("audience", "global")
    user_id = request.args.get("user")
    subscriber = _add_subscriber(audience, user_id)

    response = Response(
        stream_with_context(_event_stream(subscriber)),
        mimetype="text/event-stream",
    )
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response


if __name__ == "__main__":
    app.run(debug=True, port=5003)
