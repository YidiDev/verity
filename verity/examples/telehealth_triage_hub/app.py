from __future__ import annotations

import datetime
import json
import math
import queue
import random
import threading
import uuid
from collections import Counter
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from flask import (
    Flask,
    Response,
    abort,
    jsonify,
    render_template,
    request,
    stream_with_context,
)

CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parents[2]

import sys

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from verity.shared import create_shared_static_blueprint

app = Flask(
    __name__,
    static_url_path="/static",
    static_folder=str(CURRENT_DIR / "static"),
    template_folder=str(CURRENT_DIR / "templates"),
)

app.register_blueprint(create_shared_static_blueprint())

_subscribers: List[Dict[str, Any]] = []
_subscribers_lock = threading.Lock()

ACTIVITY_LOG: List[Dict[str, Any]] = []
_DIRECTIVE_SEQUENCE = 0


def _now_iso() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat()


# --- Helpers -----------------------------------------------------------------


_SENTINEL = object()


def _generate_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def _safe_int(value: Any, default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return number if number > 0 else default


def _slice_with_pagination(
    items: List[Any],
    *,
    page: int,
    page_size: int,
) -> Tuple[List[Any], Dict[str, Any]]:
    total = len(items)
    total_pages = math.ceil(total / page_size) if total else 0
    if total_pages and page > total_pages:
        page = total_pages
    if total_pages == 0:
        page = 1
    start_index = (page - 1) * page_size if total else 0
    end_index = min(start_index + page_size, total)
    window = items[start_index:end_index]
    pagination = {
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "has_next": end_index < total,
        "has_prev": start_index > 0,
        "start_index": start_index,
        "end_index": end_index,
    }
    return window, pagination


def _query_pagination(
    prefix: str,
    *,
    default_page_size: int = 20,
    max_page_size: int = 200,
) -> Tuple[int, int]:
    page = _safe_int(request.args.get(f"{prefix}_page"), 1)
    page_size = _safe_int(request.args.get(f"{prefix}_page_size"), default_page_size)
    page_size = min(max(page_size, 1), max_page_size)
    return page, page_size


def _resolve_provider_name(provider_id: Optional[str]) -> Optional[str]:
    if not provider_id:
        return None
    provider = PROVIDERS.get(provider_id)
    if not provider:
        return None
    return provider.get("name")


def _ensure_case_structure(case_id: str) -> Dict[str, Any]:
    case = CASES.setdefault(case_id, {"id": case_id})
    patient = case.setdefault("patient", {})
    patient.setdefault("name", case_id)
    summary = case.setdefault("summary", {})
    summary.setdefault("triage", summary.get("triage", ""))
    summary.setdefault("last_vitals", summary.get("last_vitals", {}))
    summary.setdefault("last_updated", summary.get("last_updated", _now_iso()))
    care_team = case.setdefault("care_team", {})
    care_team.setdefault("coordinator", care_team.get("coordinator", ""))
    assigned = care_team.setdefault("assigned_provider", {})
    assigned.setdefault("id", assigned.get("id"))
    assigned.setdefault("name", assigned.get("name"))
    care_team.setdefault("remote_nurse", care_team.get("remote_nurse", ""))
    care_team.setdefault("support_channel", care_team.get("support_channel", ""))
    if not case.get("visit_status"):
        case["visit_status"] = "awaiting_intake"
    preview = case.setdefault("chart_preview", {})
    preview.setdefault("allergies", preview.get("allergies", []))
    preview.setdefault("active_orders", preview.get("active_orders", []))
    preview.setdefault("recent_notes", preview.get("recent_notes", []))
    case.setdefault("contact_log", case.get("contact_log", []))
    case.setdefault("timeline", case.get("timeline", []))
    return case


def _merge_case_payload(
    case_id: str,
    payload: Optional[Dict[str, Any]] = None,
    *,
    default_patient_name: Optional[str] = None,
    assigned_provider_id: Any = _SENTINEL,
) -> Dict[str, Any]:
    payload = payload or {}
    case = _ensure_case_structure(case_id)
    patient = case.setdefault("patient", {})
    if default_patient_name and not patient.get("name"):
        patient["name"] = default_patient_name
    incoming_patient = payload.get("patient")
    if isinstance(incoming_patient, dict):
        for key, value in incoming_patient.items():
            if value is not None:
                patient[key] = value

    summary = case.setdefault("summary", {})
    incoming_summary = payload.get("summary")
    if isinstance(incoming_summary, dict):
        for key, value in incoming_summary.items():
            if key == "last_vitals" and isinstance(value, dict):
                summary.setdefault("last_vitals", {})
                for vital_key, vital_value in value.items():
                    if vital_value is not None:
                        summary["last_vitals"][vital_key] = vital_value
                continue
            if value is not None:
                summary[key] = value
    summary.setdefault("last_updated", summary.get("last_updated", _now_iso()))

    incoming_visit_status = payload.get("visit_status")
    if incoming_visit_status:
        case["visit_status"] = incoming_visit_status

    care_team = case.setdefault("care_team", {})
    incoming_care_team = payload.get("care_team")
    if isinstance(incoming_care_team, dict):
        for key, value in incoming_care_team.items():
            if key == "assigned_provider" and isinstance(value, dict):
                assigned = care_team.setdefault("assigned_provider", {})
                for assigned_key, assigned_value in value.items():
                    if assigned_value is not None:
                        assigned[assigned_key] = assigned_value
            elif value is not None:
                care_team[key] = value

    if assigned_provider_id is not _SENTINEL:
        assigned = care_team.setdefault("assigned_provider", {})
        assigned["id"] = assigned_provider_id
        assigned["name"] = _resolve_provider_name(assigned_provider_id)

    chart_preview = case.setdefault("chart_preview", {})
    incoming_chart = payload.get("chart_preview")
    if isinstance(incoming_chart, dict):
        for key, value in incoming_chart.items():
            if value is not None:
                chart_preview[key] = value

    return case


def _find_queue_entry(queue_id: str) -> Optional[Dict[str, Any]]:
    for entry in APPOINTMENT_QUEUES:
        if entry.get("id") == queue_id:
            return entry
    return None


def _remove_queue_entry(queue_id: str) -> Optional[Dict[str, Any]]:
    for index, entry in enumerate(APPOINTMENT_QUEUES):
        if entry.get("id") == queue_id:
            return APPOINTMENT_QUEUES.pop(index)
    return None


def _build_refresh_directives(*names: str) -> List[Dict[str, Any]]:
    directives: List[Dict[str, Any]] = []
    for name in names:
        directives.append({"op": "refresh_collection", "name": name})
    return directives


def _find_list_item(items: List[Dict[str, Any]], item_id: str) -> Optional[Tuple[int, Dict[str, Any]]]:
    for index, item in enumerate(items):
        if item.get("id") == item_id:
            return index, item
    return None


def _normalize_string_list(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if isinstance(raw, str):
        tokens = raw.replace("\r", "").split("\n")
        normalized = [segment.strip() for segment in tokens if segment.strip()]
        if not normalized and "," in raw:
            normalized = [segment.strip() for segment in raw.split(",") if segment.strip()]
        return normalized
    return []


def _normalize_provider_ids(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if isinstance(raw, str):
        return [segment.strip() for segment in raw.replace("\r", "").replace("\n", ",").split(",") if segment.strip()]
    return []


# --- Identity & authorization -----------------------------------------------


DEFAULT_USER_ID = "user-ops-jamie"

ROLE_LABELS = {
    "operations": "Operations",
    "coverage": "Coverage",
    "briefing": "Daily brief",
    "library": "Reference library",
}


AUDIENCE_OPERATIONS = {"roles": ["operations"]}
AUDIENCE_OPERATIONS_AND_COVERAGE = {"roles": ["operations", "coverage"]}
AUDIENCE_OPERATIONS_AND_BRIEFING = {"roles": ["operations", "briefing"]}
AUDIENCE_OPERATIONS_AND_LIBRARY = {"roles": ["operations", "library"]}
AUDIENCE_COVERAGE_ONLY = {"roles": ["coverage"]}
AUDIENCE_BRIEFING_ONLY = {"roles": ["briefing"]}
AUDIENCE_LIBRARY_ONLY = {"roles": ["library"]}


USERS: Dict[str, Dict[str, Any]] = {
    DEFAULT_USER_ID: {
        "id": DEFAULT_USER_ID,
        "name": "Jamie Lee, RN",
        "title": "Operations coordinator",
        "roles": ["operations", "coverage", "briefing", "library"],
        "home_view": "dashboard",
        "views": ["dashboard", "coverage", "briefing", "resources"],
    },
    "user-coverage-samira": {
        "id": "user-coverage-samira",
        "name": "Samira Patel",
        "title": "Coverage supervisor",
        "roles": ["coverage", "briefing"],
        "home_view": "coverage",
        "views": ["coverage", "briefing"],
    },
    "user-library-riley": {
        "id": "user-library-riley",
        "name": "Riley Chen",
        "title": "Resource curator",
        "roles": ["library"],
        "home_view": "resources",
        "views": ["resources"],
    },
    "user-brief-avery": {
        "id": "user-brief-avery",
        "name": "Avery Johnson",
        "title": "Briefing lead",
        "roles": ["briefing"],
        "home_view": "briefing",
        "views": ["briefing"],
    },
}


def _get_user(user_id: Optional[str]) -> Dict[str, Any]:
    if user_id and user_id in USERS:
        return USERS[user_id]
    return USERS[DEFAULT_USER_ID]


def _resolve_request_user() -> Dict[str, Any]:
    user_id: Optional[str] = None
    if request.headers.get("X-User-Id"):
        user_id = request.headers.get("X-User-Id")
    elif request.args.get("user_id"):
        user_id = request.args.get("user_id")
    else:
        try:
            payload = request.get_json(force=False, silent=True) or {}
        except Exception:  # pragma: no cover - defensive
            payload = {}
        if isinstance(payload, dict):
            user_id = payload.get("user_id")
    return _get_user(user_id)


def _user_has_role(user: Dict[str, Any], role: str) -> bool:
    return role in user.get("roles", [])


def _require_roles(user: Dict[str, Any], *roles: str) -> None:
    if not roles:
        return
    if any(_user_has_role(user, role) for role in roles):
        return
    response = jsonify(
        {
            "error": "forbidden",
            "required_roles": list(roles),
            "user_roles": user.get("roles", []),
        }
    )
    response.status_code = 403
    abort(response)


def _serialize_user(user: Dict[str, Any]) -> Dict[str, Any]:
    payload = {
        "id": user.get("id"),
        "name": user.get("name"),
        "title": user.get("title"),
        "roles": list(user.get("roles", [])),
        "home_view": user.get("home_view", "dashboard"),
        "views": list(user.get("views", [])),
    }
    payload["role_labels"] = [ROLE_LABELS.get(role, role.title()) for role in payload["roles"]]
    return payload


def _authorized_user(*roles: str) -> Dict[str, Any]:
    user = _resolve_request_user()
    if roles:
        _require_roles(user, *roles)
    return user

# --- In-memory domain model -------------------------------------------------

VISIT_STATUS_LABELS = {
    "awaiting_intake": "Awaiting intake",
    "pre_visit_checks": "Pre-visit checks",
    "awaiting_consult": "Awaiting consult",
    "in_consult": "In consult",
    "wrap_up": "Wrap up",
}


APPOINTMENT_QUEUES: list[Dict[str, Any]] = [
    {
        "id": "apt-101",
        "patient": "Darius Cole",
        "chief_complaint": "Chest tightness",
        "scheduled_for": "09:30",
        "priority": "urgent",
        "case_id": "case-101",
        "escalation_flag": True,
        "assigned_provider_id": "prv-1",
        "assigned_provider_name": "A. Kim, NP",
        "visit_status": "awaiting_consult",
        "last_contacted_at": _now_iso(),
    },
    {
        "id": "apt-102",
        "patient": "Layla Nguyen",
        "chief_complaint": "Medication review",
        "scheduled_for": "09:45",
        "priority": "routine",
        "case_id": "case-102",
        "escalation_flag": False,
        "assigned_provider_id": "prv-3",
        "assigned_provider_name": "M. O'Brien, PA",
        "visit_status": "pre_visit_checks",
        "last_contacted_at": _now_iso(),
    },
    {
        "id": "apt-103",
        "patient": "Sanjay Patel",
        "chief_complaint": "Post-op wound check",
        "scheduled_for": "10:00",
        "priority": "high",
        "case_id": "case-103",
        "escalation_flag": False,
        "assigned_provider_id": None,
        "assigned_provider_name": None,
        "visit_status": "awaiting_intake",
        "last_contacted_at": _now_iso(),
    },
]

PROVIDERS: Dict[str, Dict[str, Any]] = {
    "prv-1": {
        "id": "prv-1",
        "name": "A. Kim, NP",
        "availability": "Video consult in 5 min",
        "status": "on_shift",
        "specialty": "Cardiology",
        "next_slot": "09:40",
        "coverage_notes": "Handles cardiac escalations and shortness of breath callbacks",
    },
    "prv-2": {
        "id": "prv-2",
        "name": "R. Singh, MD",
        "availability": "Reviewing overnight escalations",
        "status": "in_consult",
        "specialty": "Hospitalist",
        "next_slot": "10:15",
        "coverage_notes": "Leads complex inpatient transitions; monitors ICU overflow",
    },
    "prv-3": {
        "id": "prv-3",
        "name": "M. O'Brien, PA",
        "availability": "Docs available now",
        "status": "available",
        "specialty": "Primary Care",
        "next_slot": "Now",
        "coverage_notes": "Great with med-reconciliation and chronic care coaching",
    },
}

CASES: Dict[str, Dict[str, Any]] = {
    "case-101": {
        "id": "case-101",
        "patient": {
            "name": "Darius Cole",
            "dob": "1980-04-17",
            "mrn": "MC-458329",
        },
        "summary": {
            "triage": "Nurse flagged possible ACS, trending vitals",
            "last_vitals": {
                "bp": "142/92",
                "hr": 108,
                "spo2": "95%",
            },
            "last_updated": _now_iso(),
        },
        "care_team": {
            "coordinator": "Jamie Lee, RN",
            "assigned_provider": {
                "id": "prv-1",
                "name": "A. Kim, NP",
            },
            "remote_nurse": "Triage Nurse",
            "support_channel": "Cardiology escalation room",
        },
        "visit_status": "awaiting_consult",
        "chart_preview": {
            "allergies": ["Penicillin"],
            "active_orders": ["Telemetry", "Nitro PRN"],
            "recent_notes": [
                {
                    "author": "Triage Nurse",
                    "entered_at": "2024-02-12T14:08:00Z",
                    "text": "Patient reports tightness radiating to left arm. EKG requested.",
                }
            ],
        },
        "contact_log": [
            {
                "ts": _now_iso(),
                "method": "Phone call",
                "contact": "Patient",
                "summary": "Confirmed chest tightness overnight; denies dizziness.",
                "logged_by": "Jamie Lee, RN",
            }
        ],
        "timeline": [
            {
                "ts": _now_iso(),
                "type": "intake",
                "entered_by": "Triage Nurse",
                "summary": "Intake complete, awaiting NP consult.",
            }
        ],
    },
    "case-102": {
        "id": "case-102",
        "patient": {
            "name": "Layla Nguyen",
            "dob": "1994-11-02",
            "mrn": "MC-458221",
        },
        "summary": {
            "triage": "Pharmacist follow-up on new hypertension meds",
            "last_vitals": {
                "bp": "124/78",
                "hr": 72,
                "spo2": "99%",
            },
            "last_updated": _now_iso(),
        },
        "care_team": {
            "coordinator": "Jamie Lee, RN",
            "assigned_provider": {
                "id": "prv-3",
                "name": "M. O'Brien, PA",
            },
            "remote_nurse": "Care coach",
            "support_channel": "Secure chat #pharmacy",
        },
        "visit_status": "pre_visit_checks",
        "chart_preview": {
            "allergies": ["None"],
            "active_orders": ["CMP panel"],
            "recent_notes": [
                {
                    "author": "Clinical Pharmacist",
                    "entered_at": "2024-02-11T18:32:00Z",
                    "text": "Educated patient on monitoring dizziness with titration.",
                }
            ],
        },
        "contact_log": [
            {
                "ts": _now_iso(),
                "method": "Secure chat",
                "contact": "Patient",
                "summary": "Shared reminder on BP cuff positioning before today's call.",
                "logged_by": "Care coach",
            }
        ],
        "timeline": [
            {
                "ts": _now_iso(),
                "type": "med_review",
                "entered_by": "Clinical Pharmacist",
                "summary": "Reviewed titration plan and confirmed meds on-hand.",
            }
        ],
    },
    "case-103": {
        "id": "case-103",
        "patient": {
            "name": "Sanjay Patel",
            "dob": "1971-09-26",
            "mrn": "MC-458197",
        },
        "summary": {
            "triage": "Suture line erythema day 3 post-op",
            "last_vitals": {
                "bp": "118/74",
                "hr": 81,
                "spo2": "98%",
            },
            "last_updated": _now_iso(),
        },
        "care_team": {
            "coordinator": "Jamie Lee, RN",
            "assigned_provider": None,
            "remote_nurse": "Home health RN",
            "support_channel": "#surgical-recovery",
        },
        "visit_status": "awaiting_intake",
        "chart_preview": {
            "allergies": ["Iodine"],
            "active_orders": ["Culture wound", "Silver dressing"],
            "recent_notes": [
                {
                    "author": "Home Health RN",
                    "entered_at": "2024-02-12T12:04:00Z",
                    "text": "Mild warmth noted, patient denies fever.",
                }
            ],
        },
        "contact_log": [
            {
                "ts": _now_iso(),
                "method": "Video check-in",
                "contact": "Home health RN",
                "summary": "Requested updated wound photo before surgeon review.",
                "logged_by": "Coverage coordinator",
            }
        ],
        "timeline": [
            {
                "ts": _now_iso(),
                "type": "awaiting_intake",
                "entered_by": "Coverage coordinator",
                "summary": "Awaiting updated wound photos from field nurse.",
            }
        ],
    },
}


# Coordinated coverage pods, shift reminders, and playbooks keep the SPA's
# additional views grounded in day-to-day operations instead of demo filler.
COVERAGE_TEAMS: List[Dict[str, Any]] = [
    {
        "id": "cardiology-pod",
        "name": "Cardiology escalation pod",
        "shift_window": "07:00 – 15:00 ET",
        "handoff_channel": "#cardio-escalations",
        "primary_lead": "R. Singh, MD",
        "support_roles": ["Jamie Lee, RN", "Night float RN"],
        "provider_ids": ["prv-1", "prv-2"],
        "coverage_notes": "Keep ACS board refreshed every 15 minutes and pre-brief ICU on escalations.",
    },
    {
        "id": "primary-care-day",
        "name": "Primary care day team",
        "shift_window": "08:00 – 16:00 ET",
        "handoff_channel": "#pc-day",
        "primary_lead": "M. O'Brien, PA",
        "support_roles": ["Pharmacy coach", "Medical assistant"],
        "provider_ids": ["prv-3"],
        "coverage_notes": "Focus on chronic care check-ins and med reconciliation follow ups.",
    },
    {
        "id": "surgical-recovery",
        "name": "Surgical recovery watch",
        "shift_window": "09:00 – 17:00 ET",
        "handoff_channel": "#surgical-recovery",
        "primary_lead": "Covering surgeon",
        "support_roles": ["Home health RN", "Coverage coordinator"],
        "provider_ids": [],
        "coverage_notes": "Coordinate daily wound photo uploads and escalate redness or drainage immediately.",
    },
]

COVERAGE_SUPPORT_CONTACTS: List[Dict[str, Any]] = [
    {
        "id": "support-telemetry",
        "name": "Telemetry support",
        "channel": "Pager 5512",
        "hours": "24/7",
        "notes": "Helps troubleshoot remote monitoring kits and connectivity outages.",
    },
    {
        "id": "support-behavioral",
        "name": "Behavioral health warm line",
        "channel": "Teams: Behavioral Health",
        "hours": "08:00 – 22:00 ET",
        "notes": "Available for crisis consults during primary care visits.",
    },
    {
        "id": "support-interpreter",
        "name": "Interpreter services",
        "channel": "x2201",
        "hours": "06:00 – 24:00 ET",
        "notes": "Queue for on-demand Spanish and Vietnamese interpreters.",
    },
]

OPERATIONS_INCIDENT_LOG: List[Dict[str, Any]] = [
    {
        "id": "incident-overnight-clear",
        "ts": "05:30",
        "summary": "Night team cleared two cardiology escalations after troponin labs returned normal.",
        "owner": "Night RN team",
    },
    {
        "id": "incident-firmware-reboot",
        "ts": "06:15",
        "summary": "Remote telemetry device for Layla Nguyen rebooted after firmware push.",
        "owner": "Telemetry support",
    },
]

BRIEF_STAFFING_CALLS: List[Dict[str, Any]] = [
    {
        "id": "staffing-behavioral",
        "team": "Behavioral health",
        "need": "Secure afternoon float coverage for therapy handoffs",
        "eta": "By 13:00 ET",
    },
    {
        "id": "staffing-remote-monitoring",
        "team": "Remote monitoring",
        "need": "Swap faulty cardiac kit at patient home",
        "eta": "Courier pickup 11:30 ET",
    },
]

RESOURCE_PLAYBOOKS: List[Dict[str, Any]] = [
    {
        "id": "acs-routed-care",
        "title": "Suspected ACS triage",
        "updated_at": "2024-02-05",
        "owner": "Clinical operations",
        "highlights": [
            "Collect vitals twice before physician consult.",
            "Escalate to cardiology if chest pain persists > 10 minutes after nitro.",
            "Document troponin draw time in the handoff note.",
        ],
    },
    {
        "id": "med-titration",
        "title": "Hypertension titration callbacks",
        "updated_at": "2024-01-28",
        "owner": "Pharmacy team",
        "highlights": [
            "Confirm home cuff calibration quarterly.",
            "Schedule pharmacist follow-up if BP > 160/100 twice in 24h.",
            "Send secure chat recap using medication education template.",
        ],
    },
    {
        "id": "post-op-watch",
        "title": "Post-operative wound monitoring",
        "updated_at": "2024-02-09",
        "owner": "Surgical recovery",
        "highlights": [
            "Request photo uploads daily until redness resolves.",
            "Escalate new drainage or fever > 100.4°F immediately.",
            "Coordinate home health RN visit if wound edges separate.",
        ],
    },
]


_SEED_COMPLETE = False


def _seed_generated_domain_data() -> None:
    global _SEED_COMPLETE
    if _SEED_COMPLETE:
        return

    rng = random.Random(42)

    first_names = [
        "Avery",
        "Jordan",
        "Dakota",
        "Harper",
        "Riley",
        "Skyler",
        "Morgan",
        "Parker",
        "Reese",
        "Sydney",
    ]
    last_names = [
        "Lopez",
        "Chen",
        "Ramirez",
        "Okafor",
        "Hernandez",
        "Ibarra",
        "Desai",
        "Owens",
        "Bautista",
        "Whitfield",
        "Hassan",
        "El-Sayed",
        "Gallagher",
        "Moretti",
        "Thompson",
    ]
    credentials = ["MD", "NP", "PA", "DO"]
    specialties = [
        "Cardiology",
        "Primary Care",
        "Pulmonology",
        "Endocrinology",
        "Behavioral Health",
        "Nephrology",
        "Oncology",
        "Urgent Care",
        "Hospitalist",
        "Dermatology",
    ]
    provider_statuses = ["available", "on_shift", "in_consult"]
    availability_phrases = [
        "Reviewing labs",
        "Charting wrap-up",
        "Next slot in 10 min",
        "On video consult",
        "Ready for intake",
        "Coaching remote nurse",
        "Standing by for escalation",
        "Outbound outreach",
    ]

    # Expand provider roster
    for index in range(4, 64):
        provider_id = f"prv-{index}"
        if provider_id in PROVIDERS:
            continue
        first = rng.choice(first_names)
        last = rng.choice(last_names)
        credential = rng.choice(credentials)
        PROVIDERS[provider_id] = {
            "id": provider_id,
            "name": f"{first} {last}, {credential}",
            "availability": rng.choice(availability_phrases),
            "status": rng.choice(provider_statuses),
            "specialty": rng.choice(specialties),
            "next_slot": f"{rng.randint(7, 19):02d}:{rng.choice([0, 15, 30, 45]):02d}",
            "coverage_notes": "Handles complex follow-ups and partners with remote pods.",
        }

    provider_ids = list(PROVIDERS.keys())

    complaints = [
        "Medication review",
        "Shortness of breath",
        "Suture check",
        "Behavioral health warm handoff",
        "Lab follow-up",
        "Remote monitoring alert",
        "Diabetes coaching",
        "Device troubleshooting",
        "Discharge planning",
        "Telehealth consult",
    ]
    priorities = ["routine", "high", "urgent"]
    visit_status_keys = list(VISIT_STATUS_LABELS.keys())
    coordinators = [
        "Jamie Lee, RN",
        "Andre Silva, RN",
        "Mina Patel, RN",
        "Chris Jordan, RN",
    ]
    support_channels = [
        "#cardio-escalations",
        "#remote-monitoring",
        "#behavioral-health",
        "#pc-day",
        "#surgical-recovery",
    ]
    remote_roles = [
        "Remote nurse",
        "Care coach",
        "Telehealth MA",
        "Home health RN",
        "Behavioral health specialist",
    ]
    contact_methods = ["Phone call", "Secure chat", "SMS follow-up", "Video check-in"]
    timeline_types = ["intake", "handoff", "follow_up", "assignment", "escalation", "consult"]

    now = datetime.datetime.now(datetime.UTC)

    for index in range(104, 304):
        case_id = f"case-{index}"
        if case_id in CASES:
            continue
        patient_first = rng.choice(first_names)
        patient_last = rng.choice(last_names)
        patient_name = f"{patient_first} {patient_last}"
        dob_year = rng.randint(1952, 2002)
        dob = datetime.date(dob_year, rng.randint(1, 12), rng.randint(1, 28))
        mrn = f"MC-{rng.randint(400000, 499999)}"

        assigned_provider_id = rng.choice(provider_ids + [None, None])
        assigned_provider_name = _resolve_provider_name(assigned_provider_id)
        visit_status = rng.choice(visit_status_keys)
        escalation_flag = rng.random() < 0.25

        contact_log: List[Dict[str, Any]] = []
        for step in range(rng.randint(8, 18)):
            ts = (now - datetime.timedelta(minutes=step * 18 + rng.randint(0, 9))).isoformat()
            contact_log.append(
                {
                    "ts": ts,
                    "method": rng.choice(contact_methods),
                    "contact": rng.choice(["Patient", "Caregiver", "Field nurse"]),
                    "summary": f"Discussed {rng.choice(['symptoms', 'med changes', 'device sync', 'care plan'])} and documented update.",
                    "logged_by": rng.choice(coordinators),
                }
            )

        timeline: List[Dict[str, Any]] = []
        for step in range(rng.randint(10, 20)):
            ts = (now - datetime.timedelta(minutes=step * 15 + rng.randint(0, 5))).isoformat()
            timeline.append(
                {
                    "ts": ts,
                    "type": rng.choice(timeline_types),
                    "entered_by": rng.choice(coordinators),
                    "summary": f"{rng.choice(['Reviewed vitals', 'Coordinated escalation', 'Updated plan', 'Synced with pod'])} for {patient_name}.",
                }
            )

        contact_log.sort(key=lambda entry: entry["ts"], reverse=True)
        timeline.sort(key=lambda entry: entry["ts"], reverse=True)

        last_vitals = {
            "bp": f"{rng.randint(108, 148)}/{rng.randint(62, 92)}",
            "hr": rng.randint(58, 112),
            "spo2": f"{rng.randint(93, 99)}%",
        }

        case_payload = {
            "id": case_id,
            "patient": {
                "name": patient_name,
                "dob": dob.isoformat(),
                "mrn": mrn,
            },
            "summary": {
                "triage": f"{rng.choice(['Monitoring', 'Follow-up', 'Escalation review', 'Consult prep'])} for {rng.choice(complaints).lower()}.",
                "last_vitals": last_vitals,
                "last_updated": _now_iso(),
            },
            "care_team": {
                "coordinator": rng.choice(coordinators),
                "assigned_provider": {"id": assigned_provider_id, "name": assigned_provider_name} if assigned_provider_id else None,
                "remote_nurse": rng.choice(remote_roles),
                "support_channel": rng.choice(support_channels),
            },
            "visit_status": visit_status,
            "chart_preview": {
                "allergies": [rng.choice(["Penicillin", "Latex", "Sulfa", "None noted"])],
                "active_orders": [rng.choice(["Telemetry", "CMP panel", "Daily vitals", "Nurse follow-up"])],
                "recent_notes": [
                    {
                        "author": rng.choice(coordinators),
                        "entered_at": (now - datetime.timedelta(minutes=rng.randint(30, 360))).isoformat(),
                        "text": f"{rng.choice(['Coached patient on device sync', 'Coordinated with specialist', 'Documented symptom trend'])}.",
                    }
                ],
            },
            "contact_log": contact_log,
            "timeline": timeline,
        }

        CASES[case_id] = case_payload

        queue_entry = {
            "id": f"apt-{index}",
            "patient": patient_name,
            "chief_complaint": rng.choice(complaints),
            "scheduled_for": f"{rng.randint(7, 19):02d}:{rng.choice([0, 15, 30, 45]):02d}",
            "priority": rng.choice(priorities),
            "case_id": case_id,
            "escalation_flag": escalation_flag,
            "assigned_provider_id": assigned_provider_id,
            "assigned_provider_name": assigned_provider_name,
            "visit_status": visit_status,
            "last_contacted_at": contact_log[0]["ts"] if contact_log else _now_iso(),
        }
        APPOINTMENT_QUEUES.append(queue_entry)

    APPOINTMENT_QUEUES.sort(key=lambda entry: (entry.get("scheduled_for") or "", entry.get("patient") or ""))

    # Expand coverage pods and reference data
    for index in range(4, 18):
        team_id = f"coverage-team-{index}"
        COVERAGE_TEAMS.append(
            {
                "id": team_id,
                "name": f"Regional coverage pod {index}",
                "shift_window": f"{6 + index % 6:02d}:00 – {14 + index % 6:02d}:00 ET",
                "handoff_channel": f"#coverage-{index}",
                "primary_lead": rng.choice(coordinators),
                "support_roles": [rng.choice(remote_roles), rng.choice(remote_roles)],
                "provider_ids": rng.sample(provider_ids, k=min(3, len(provider_ids))),
                "coverage_notes": "Auto-generated coverage pod for large dataset exercises.",
            }
        )

    for index in range(4, 18):
        COVERAGE_SUPPORT_CONTACTS.append(
            {
                "id": f"support-contact-{index}",
                "name": f"Support service {index}",
                "channel": f"Ext {5000 + index}",
                "hours": "24/7",
                "notes": "Escalation-ready support contact for expanded dataset.",
            }
        )

    for index in range(4, 28):
        OPERATIONS_INCIDENT_LOG.append(
            {
                "id": f"incident-{index}",
                "ts": f"0{index % 9}:{rng.choice(['00', '15', '30', '45'])}",
                "summary": f"Auto-generated incident {index} resolved by coverage team.",
                "owner": rng.choice(coordinators),
            }
        )

    for index in range(4, 24):
        BRIEF_STAFFING_CALLS.append(
            {
                "id": f"staffing-{index}",
                "team": f"Support pod {index}",
                "need": "Additional float coverage requested.",
                "eta": f"By {8 + index % 8:02d}:{rng.choice(['00', '30'])} ET",
            }
        )

    for index in range(4, 32):
        RESOURCE_PLAYBOOKS.append(
            {
                "id": f"playbook-{index}",
                "title": f"Auto-generated protocol {index}",
                "updated_at": (now - datetime.timedelta(days=index)).date().isoformat(),
                "owner": rng.choice(["Clinical operations", "Nursing", "Behavioral health"]),
                "highlights": [
                    "Outline escalation triggers",
                    "Checklist for outreach",
                    "Reference scripts for coordinators",
                ],
            }
        )

    # Seed historical activity
    for entry in APPOINTMENT_QUEUES[:160]:
        ACTIVITY_LOG.append(
            {
                "type": "queue.case_seeded",
                "activity": f"{entry['patient']}: queued for {entry['chief_complaint'].lower()}",
                "actor": rng.choice(coordinators),
                "case_id": entry["case_id"],
                "ts": (now - datetime.timedelta(minutes=rng.randint(0, 720))).isoformat(),
            }
        )

    ACTIVITY_LOG.sort(key=lambda event: event.get("ts", ""), reverse=True)

    _SEED_COMPLETE = True


_seed_generated_domain_data()


# --- Directive helpers ------------------------------------------------------

def _clone_for_activity(event: Dict[str, Any]) -> Dict[str, Any]:
    return json.loads(json.dumps(event))


def _record_activity(event: Dict[str, Any]) -> None:
    copy = _clone_for_activity(event)
    ACTIVITY_LOG.insert(0, copy)
    del ACTIVITY_LOG[500:]


def _append_timeline(
    case: Dict[str, Any],
    *,
    summary: str,
    entered_by: str,
    type: str,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    entry = {
        "ts": _now_iso(),
        "summary": summary,
        "entered_by": entered_by,
        "type": type,
    }
    if details:
        entry["details"] = details
    timeline = case.setdefault("timeline", [])
    timeline.insert(0, entry)
    return entry


def _build_provider_snapshot(provider_id: str) -> Dict[str, Any]:
    provider = PROVIDERS.get(provider_id)
    if not provider:
        return {}
    assignments = [
        {
            "case_id": entry["case_id"],
            "patient": entry["patient"],
            "visit_status": entry.get("visit_status"),
        }
        for entry in APPOINTMENT_QUEUES
        if entry.get("assigned_provider_id") == provider_id
    ]
    snapshot = dict(provider)
    snapshot["active_cases"] = assignments
    snapshot["active_case_count"] = len(assignments)
    snapshot["refreshed_at"] = _now_iso()
    return snapshot


def _update_queue_entry(case_id: str, **fields: Any) -> Optional[Dict[str, Any]]:
    for entry in APPOINTMENT_QUEUES:
        if entry["case_id"] == case_id:
            entry.update(fields)
            return entry
    return None


def _scheduled_wait_minutes(scheduled_for: Optional[str], *, reference: Optional[datetime.datetime] = None) -> Optional[float]:
    if not scheduled_for:
        return None
    try:
        hour, minute = map(int, scheduled_for.split(":", 1))
    except (TypeError, ValueError):
        return None
    reference = reference or datetime.datetime.now(datetime.UTC)
    scheduled_dt = reference.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if reference <= scheduled_dt:
        return 0.0
    wait = reference - scheduled_dt
    return round(wait.total_seconds() / 60.0, 1)


def _format_counter(counter: Counter, *, ordered_keys: Optional[Iterable[str]] = None) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    keys: Iterable[str]
    if ordered_keys is not None:
        keys = ordered_keys
    else:
        keys = counter.keys()
    for key in keys:
        items.append({"key": key, "count": int(counter.get(key, 0))})
    return items


def _compute_operations_metrics() -> Dict[str, Any]:
    now = datetime.datetime.now(datetime.UTC)
    status_counter: Counter = Counter()
    priority_counter: Counter = Counter()
    escalated_cases: List[Dict[str, Any]] = []
    awaiting_assignment: List[Dict[str, Any]] = []
    wait_samples: List[float] = []

    for entry in APPOINTMENT_QUEUES:
        status = entry.get("visit_status")
        if status:
            status_counter[status] += 1
        priority = entry.get("priority")
        if priority:
            priority_counter[priority] += 1

        if entry.get("escalation_flag"):
            escalated_cases.append(
                {
                    "case_id": entry["case_id"],
                    "patient": entry.get("patient"),
                    "status": VISIT_STATUS_LABELS.get(status, status),
                    "scheduled_for": entry.get("scheduled_for"),
                }
            )

        if not entry.get("assigned_provider_id"):
            awaiting_assignment.append(
                {
                    "case_id": entry["case_id"],
                    "patient": entry.get("patient"),
                    "priority": entry.get("priority"),
                    "scheduled_for": entry.get("scheduled_for"),
                }
            )

        wait = _scheduled_wait_minutes(entry.get("scheduled_for"), reference=now)
        if wait is not None:
            wait_samples.append(wait)

    contact_counter: Counter = Counter()
    timeline_counter = 0
    cases_touched_today = 0
    touchpoints_last_four_hours = 0
    assignments_today = 0

    for case in CASES.values():
        recent_touch = False
        for contact in case.get("contact_log", []):
            method = contact.get("method") or "Other"
            contact_counter[method] += 1
            ts = contact.get("ts")
            if ts:
                try:
                    contact_ts = datetime.datetime.fromisoformat(ts)
                except ValueError:
                    continue
                if now - contact_ts <= datetime.timedelta(hours=4):
                    touchpoints_last_four_hours += 1
                if now - contact_ts <= datetime.timedelta(hours=24):
                    recent_touch = True

        for entry in case.get("timeline", []):
            ts = entry.get("ts")
            if not ts:
                continue
            try:
                entry_ts = datetime.datetime.fromisoformat(ts)
            except ValueError:
                continue
            if now - entry_ts <= datetime.timedelta(hours=24):
                timeline_counter += 1
                if entry.get("type") == "assignment":
                    assignments_today += 1
                recent_touch = True

        if recent_touch:
            cases_touched_today += 1

    avg_wait = round(sum(wait_samples) / len(wait_samples), 1) if wait_samples else None
    longest_wait = max(wait_samples) if wait_samples else None

    provider_load = [
        {
            "id": snapshot.get("id"),
            "name": snapshot.get("name"),
            "status": snapshot.get("status"),
            "active_case_count": snapshot.get("active_case_count", 0),
        }
        for snapshot in (_build_provider_snapshot(pid) for pid in PROVIDERS)
    ]

    metrics = {
        "queue": {
            "total": len(APPOINTMENT_QUEUES),
            "status_breakdown": [
                {
                    "status": status,
                    "label": VISIT_STATUS_LABELS.get(status, status.replace("_", " ").title()),
                    "count": int(status_counter.get(status, 0)),
                }
                for status in VISIT_STATUS_LABELS
            ],
            "priority_breakdown": _format_counter(
                priority_counter,
                ordered_keys=["urgent", "high", "routine"],
            ),
            "escalated_cases": escalated_cases,
            "awaiting_assignment": awaiting_assignment,
            "average_wait_minutes": avg_wait,
            "longest_wait_minutes": longest_wait,
        },
        "touchpoints": {
            "contact_volume": _format_counter(contact_counter),
            "cases_touched_today": cases_touched_today,
            "touchpoints_last_4h": touchpoints_last_four_hours,
            "timeline_updates_last_24h": timeline_counter,
            "assignments_last_24h": assignments_today,
        },
        "provider_load": provider_load,
        "refreshed_at": _now_iso(),
    }
    return metrics


def _build_operations_brief() -> Dict[str, Any]:
    priority_rank = {"urgent": 0, "high": 1, "routine": 2}
    watchlist: List[Dict[str, Any]] = []

    for entry in APPOINTMENT_QUEUES:
        reasons: List[str] = []
        if entry.get("escalation_flag"):
            reasons.append("Escalated")
        if not entry.get("assigned_provider_id"):
            reasons.append("Awaiting assignment")
        status = entry.get("visit_status")
        if status in ("awaiting_intake", "awaiting_consult"):
            reasons.append(VISIT_STATUS_LABELS.get(status, status))
        priority = entry.get("priority")
        if priority in ("urgent", "high"):
            reasons.append(f"{priority.title()} priority")

        if reasons:
            watchlist.append(
                {
                    "case_id": entry["case_id"],
                    "patient": entry.get("patient"),
                    "priority": priority,
                    "status": VISIT_STATUS_LABELS.get(status, status),
                    "scheduled_for": entry.get("scheduled_for"),
                    "assigned_provider_name": entry.get("assigned_provider_name"),
                    "reasons": reasons,
                }
            )

    watchlist.sort(
        key=lambda item: (
            priority_rank.get(item.get("priority"), 9),
            item.get("scheduled_for") or "",
        )
    )

    brief = {
        "watchlist": watchlist[:6],
        "overnight": OPERATIONS_INCIDENT_LOG,
        "staffing_calls": BRIEF_STAFFING_CALLS,
        "refreshed_at": _now_iso(),
    }
    return brief


def _resolve_team_providers(provider_ids: Iterable[str]) -> List[Dict[str, Any]]:
    roster: List[Dict[str, Any]] = []
    for provider_id in provider_ids:
        provider = PROVIDERS.get(provider_id)
        if not provider:
            continue
        snapshot = _build_provider_snapshot(provider_id)
        roster.append(
            {
                "id": provider_id,
                "name": provider.get("name"),
                "status": provider.get("status"),
                "active_case_count": snapshot.get("active_case_count", 0),
                "active_cases": snapshot.get("active_cases", []),
                "availability": provider.get("availability"),
            }
        )
    return roster


def _build_coverage_summary() -> Dict[str, Any]:
    teams: List[Dict[str, Any]] = []
    for team in COVERAGE_TEAMS:
        teams.append(
            {
                **team,
                "providers": _resolve_team_providers(team.get("provider_ids", [])),
            }
        )

    summary = {
        "teams": teams,
        "support_contacts": COVERAGE_SUPPORT_CONTACTS,
        "refreshed_at": _now_iso(),
    }
    return summary


def _normalize_audience(audience: Optional[Any]) -> Dict[str, Any]:
    if not audience:
        return {"scope": "global"}
    if isinstance(audience, str):
        if audience == "global":
            return {"scope": "global"}
        return {"scope": "filtered", "roles": [audience]}
    normalized = dict(audience)
    normalized.setdefault("scope", "filtered")

    if "user_ids" in normalized and "users" not in normalized:
        normalized["users"] = normalized.pop("user_ids")

    for key in ("roles", "users", "exclude_roles", "exclude_users"):
        if key not in normalized or normalized[key] is None:
            normalized.pop(key, None)
            continue
        values = normalized[key]
        if isinstance(values, (list, tuple, set)):
            normalized[key] = [str(value) for value in values if str(value)]
        else:
            normalized[key] = [str(values)] if str(values) else []
        if not normalized[key]:
            normalized.pop(key, None)

    if not normalized.get("roles") and not normalized.get("users") and normalized.get("scope") != "global":
        normalized["scope"] = "global"

    return normalized


def _audience_allows(subscriber: Dict[str, Any], audience: Dict[str, Any]) -> bool:
    if audience.get("scope") == "global":
        return True

    user_id = subscriber.get("user_id")
    roles = subscriber.get("roles", set())

    users = set(audience.get("users", []))
    if users and user_id not in users:
        return False

    excluded_users = set(audience.get("exclude_users", []))
    if excluded_users and user_id in excluded_users:
        return False

    excluded_roles = set(audience.get("exclude_roles", []))
    if excluded_roles and any(role in excluded_roles for role in roles):
        return False

    required_roles = set(audience.get("roles", []))
    if required_roles and not any(role in required_roles for role in roles):
        return False

    return True


def _push_to_subscribers(payload: Dict[str, Any], *, audience: Optional[Any] = None) -> None:
    normalized_audience = _normalize_audience(audience)
    with _subscribers_lock:
        buckets = list(_subscribers)
    for subscriber in buckets:
        if not _audience_allows(subscriber, normalized_audience):
            continue
        try:
            subscriber["queue"].put_nowait(payload)
        except queue.Full:
            pass


def _broadcast(event: Dict[str, Any], *, audience: Optional[Any] = None) -> None:
    event.setdefault("ts", _now_iso())
    if event.get("type") != "directives":
        _record_activity(event)
    _push_to_subscribers(event, audience=audience)


def _emit_directives(
    directives: Optional[List[Dict[str, Any]]],
    *,
    source: Optional[str] = None,
    audience: Optional[Any] = None,
) -> None:
    if not directives:
        return

    global _DIRECTIVE_SEQUENCE
    _DIRECTIVE_SEQUENCE += 1

    normalized_audience = _normalize_audience(audience)

    envelope: Dict[str, Any] = {
        "type": "directives",
        "directives": directives,
        "audience": normalized_audience,
        "seq": _DIRECTIVE_SEQUENCE,
        "ts": _now_iso(),
    }
    if source:
        envelope["source"] = source
    _push_to_subscribers(envelope, audience=normalized_audience)


def _build_case_directives(
    case_id: Optional[str],
    *,
    refresh_case: bool = False,
    refresh_queue: bool = False,
    refresh_providers: bool = False,
    refresh_metrics: bool = False,
    refresh_brief: bool = False,
    refresh_coverage: bool = False,
) -> List[Dict[str, Any]]:
    directives: List[Dict[str, Any]] = []
    if refresh_case and case_id:
        directives.append({"op": "refresh_item", "name": "case", "id": case_id})
    if refresh_queue:
        directives.append({"op": "refresh_collection", "name": "queues"})
    if refresh_providers:
        directives.append({"op": "refresh_collection", "name": "providers"})
    if refresh_metrics:
        directives.append({"op": "refresh_collection", "name": "operations_metrics"})
    if refresh_brief:
        directives.append({"op": "refresh_collection", "name": "operations_brief"})
    if refresh_coverage:
        directives.append({"op": "refresh_collection", "name": "coverage_teams"})
    return directives


# --- Routes -----------------------------------------------------------------


@app.get("/")
def home() -> str:
    return render_template("index.html")


@app.get("/api/users")
def list_users() -> Response:
    users = [_serialize_user(user) for user in USERS.values()]
    payload = {
        "users": users,
        "role_labels": ROLE_LABELS,
        "refreshed_at": _now_iso(),
    }
    return jsonify(payload)


@app.get("/api/session")
def get_session() -> Response:
    requested_id = request.args.get("user_id")
    user = _get_user(requested_id) if requested_id else _resolve_request_user()
    payload = {
        "user": _serialize_user(user),
        "role_labels": ROLE_LABELS,
        "refreshed_at": _now_iso(),
    }
    return jsonify(payload)


@app.get("/api/queues")
def get_queues() -> Response:
    _authorized_user("operations")
    page, page_size = _query_pagination("queues", default_page_size=18, max_page_size=250)
    window, pagination = _slice_with_pagination(APPOINTMENT_QUEUES, page=page, page_size=page_size)
    payload = {
        "queues": window,
        "pagination": pagination,
        "refreshed_at": _now_iso(),
    }
    return jsonify(payload)


@app.get("/api/providers")
def get_providers() -> Response:
    _authorized_user("operations", "coverage")
    provider_ids = sorted(PROVIDERS.keys())
    page, page_size = _query_pagination("providers", default_page_size=18, max_page_size=250)
    window_ids, pagination = _slice_with_pagination(provider_ids, page=page, page_size=page_size)
    providers = [_build_provider_snapshot(pid) for pid in window_ids]
    payload = {
        "providers": providers,
        "pagination": pagination,
        "refreshed_at": _now_iso(),
    }
    return jsonify(payload)


@app.get("/api/cases/<case_id>")
def get_case(case_id: str) -> Response:
    _authorized_user("operations")
    case = CASES.get(case_id)
    if not case:
        return jsonify({"error": "unknown case"}), 404
    timeline_page, timeline_size = _query_pagination("timeline", default_page_size=8, max_page_size=60)
    contacts_page, contacts_size = _query_pagination("contacts", default_page_size=8, max_page_size=60)
    timeline = list(case.get("timeline", []))
    contact_log = list(case.get("contact_log", []))
    timeline_window, timeline_pagination = _slice_with_pagination(timeline, page=timeline_page, page_size=timeline_size)
    contacts_window, contacts_pagination = _slice_with_pagination(
        contact_log, page=contacts_page, page_size=contacts_size
    )
    case_copy = deepcopy(case)
    case_copy["timeline"] = timeline_window
    case_copy["contact_log"] = contacts_window
    payload = {
        "case": case_copy,
        "pagination": {
            "timeline": timeline_pagination,
            "contacts": contacts_pagination,
        },
        "refreshed_at": _now_iso(),
    }
    return jsonify(payload)


@app.get("/api/activity")
def get_activity() -> Response:
    _authorized_user("operations")
    page, page_size = _query_pagination("activity", default_page_size=25, max_page_size=200)
    window, pagination = _slice_with_pagination(ACTIVITY_LOG, page=page, page_size=page_size)
    payload = {
        "activity": window,
        "pagination": pagination,
        "refreshed_at": _now_iso(),
    }
    return jsonify(payload)


@app.get("/api/operations/metrics")
def get_operations_metrics() -> Response:
    _authorized_user("operations", "briefing")
    metrics = _compute_operations_metrics()
    payload = {
        "metrics": metrics,
        "refreshed_at": metrics.get("refreshed_at", _now_iso()),
    }
    return jsonify(payload)


@app.get("/api/operations/brief")
def get_operations_brief() -> Response:
    _authorized_user("operations", "briefing")
    brief = _build_operations_brief()
    watchlist_page, watchlist_size = _query_pagination("watchlist", default_page_size=6, max_page_size=60)
    overnight_page, overnight_size = _query_pagination("overnight", default_page_size=6, max_page_size=60)
    staffing_page, staffing_size = _query_pagination("staffing", default_page_size=6, max_page_size=60)

    watchlist_window, watchlist_pagination = _slice_with_pagination(
        brief.get("watchlist", []), page=watchlist_page, page_size=watchlist_size
    )
    overnight_window, overnight_pagination = _slice_with_pagination(
        brief.get("overnight", []), page=overnight_page, page_size=overnight_size
    )
    staffing_window, staffing_pagination = _slice_with_pagination(
        brief.get("staffing_calls", []), page=staffing_page, page_size=staffing_size
    )

    brief = dict(brief)
    brief["watchlist"] = watchlist_window
    brief["overnight"] = overnight_window
    brief["staffing_calls"] = staffing_window

    payload = {
        "brief": brief,
        "pagination": {
            "watchlist": watchlist_pagination,
            "overnight": overnight_pagination,
            "staffing_calls": staffing_pagination,
        },
        "refreshed_at": brief.get("refreshed_at", _now_iso()),
    }
    return jsonify(payload)


@app.get("/api/coverage/teams")
def get_coverage_teams() -> Response:
    _authorized_user("coverage", "operations")
    summary = _build_coverage_summary()
    teams_page, teams_size = _query_pagination("teams", default_page_size=6, max_page_size=60)
    contacts_page, contacts_size = _query_pagination("contacts", default_page_size=8, max_page_size=80)
    teams_window, teams_pagination = _slice_with_pagination(summary.get("teams", []), page=teams_page, page_size=teams_size)
    contacts_window, contacts_pagination = _slice_with_pagination(
        summary.get("support_contacts", []), page=contacts_page, page_size=contacts_size
    )
    summary["teams"] = teams_window
    summary["support_contacts"] = contacts_window
    payload = {
        "coverage": summary,
        "pagination": {
            "teams": teams_pagination,
            "support_contacts": contacts_pagination,
        },
        "refreshed_at": summary.get("refreshed_at", _now_iso()),
    }
    return jsonify(payload)


@app.get("/api/resources/playbooks")
def get_resource_playbooks() -> Response:
    _authorized_user("library", "operations")
    page, page_size = _query_pagination("playbooks", default_page_size=12, max_page_size=120)
    window, pagination = _slice_with_pagination(RESOURCE_PLAYBOOKS, page=page, page_size=page_size)
    payload = {
        "playbooks": window,
        "pagination": pagination,
        "refreshed_at": _now_iso(),
    }
    return jsonify(payload)


@app.post("/api/queues")
def create_queue_entry() -> Response:
    user = _authorized_user("operations")
    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Operations coordinator"
    actor = incoming.get("created_by") or incoming.get("actor") or default_actor
    case_payload = incoming.get("case") if isinstance(incoming.get("case"), dict) else {}
    queue_id = incoming.get("id") or _generate_id("apt")
    case_id = incoming.get("case_id") or case_payload.get("id") or _generate_id("case")
    patient_name = (
        incoming.get("patient")
        or (case_payload.get("patient") or {}).get("name")
        or "New patient"
    )
    provider_id = incoming.get("assigned_provider_id") or None
    assigned_name = (
        incoming.get("assigned_provider_name")
        or _resolve_provider_name(provider_id)
    )
    entry = {
        "id": queue_id,
        "case_id": case_id,
        "patient": patient_name,
        "chief_complaint": incoming.get("chief_complaint") or "",
        "scheduled_for": incoming.get("scheduled_for"),
        "priority": incoming.get("priority") or "routine",
        "escalation_flag": bool(incoming.get("escalation_flag")),
        "assigned_provider_id": provider_id,
        "assigned_provider_name": assigned_name,
        "visit_status": incoming.get("visit_status")
        or case_payload.get("visit_status")
        or "awaiting_intake",
        "last_contacted_at": incoming.get("last_contacted_at"),
    }
    APPOINTMENT_QUEUES.append(entry)

    case_payload = case_payload or {}
    case_payload.setdefault("visit_status", entry["visit_status"])
    case = _merge_case_payload(
        case_id,
        case_payload,
        default_patient_name=entry["patient"],
        assigned_provider_id=provider_id,
    )

    activity_message = f"{entry['patient']}: added to queue by {actor}"
    event = {
        "type": "queue.appointment_created",
        "actor": actor,
        "case_id": case_id,
        "queue_id": queue_id,
        "activity": activity_message,
        "payload": {
            "queue_entry": entry,
            "case": case,
        },
    }
    directives = _build_case_directives(
        case_id,
        refresh_case=True,
        refresh_queue=True,
        refresh_providers=True,
        refresh_metrics=True,
        refresh_brief=True,
    )
    _broadcast(event, audience=AUDIENCE_OPERATIONS)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS)
    return jsonify({
        "queue": entry,
        "case": case,
        "event": event,
        "directives": directives,
    })


@app.patch("/api/queues/<queue_id>")
def update_queue_entry(queue_id: str) -> Response:
    user = _authorized_user("operations")
    entry = _find_queue_entry(queue_id)
    if not entry:
        return jsonify({"error": "unknown queue entry"}), 404

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Operations coordinator"
    actor = incoming.get("updated_by") or incoming.get("actor") or default_actor

    if "patient" in incoming and incoming["patient"] is not None:
        entry["patient"] = incoming["patient"]
    if "chief_complaint" in incoming:
        entry["chief_complaint"] = incoming.get("chief_complaint") or ""
    if "scheduled_for" in incoming:
        entry["scheduled_for"] = incoming.get("scheduled_for")
    if "priority" in incoming and incoming["priority"]:
        entry["priority"] = incoming["priority"]
    if "escalation_flag" in incoming:
        entry["escalation_flag"] = bool(incoming.get("escalation_flag"))
    if "visit_status" in incoming and incoming["visit_status"]:
        entry["visit_status"] = incoming["visit_status"]

    provider_id = entry.get("assigned_provider_id")
    assigned_name = entry.get("assigned_provider_name")
    if "assigned_provider_id" in incoming:
        provider_id = incoming.get("assigned_provider_id") or None
        assigned_name = incoming.get("assigned_provider_name") or _resolve_provider_name(provider_id)
        entry["assigned_provider_id"] = provider_id
        entry["assigned_provider_name"] = assigned_name

    case_id = entry.get("case_id")
    case_payload = incoming.get("case") if isinstance(incoming.get("case"), dict) else {}
    case = _merge_case_payload(
        case_id,
        case_payload,
        default_patient_name=entry.get("patient"),
        assigned_provider_id=provider_id if "assigned_provider_id" in incoming else _SENTINEL,
    )
    if "visit_status" in incoming and case:
        case["visit_status"] = entry.get("visit_status")

    activity_message = f"{entry['patient']}: queue details updated by {actor}"
    event = {
        "type": "queue.appointment_updated",
        "actor": actor,
        "case_id": case_id,
        "queue_id": queue_id,
        "activity": activity_message,
        "payload": {
            "queue_entry": entry,
            "case": case,
        },
    }
    directives = _build_case_directives(
        case_id,
        refresh_case=True,
        refresh_queue=True,
        refresh_providers=True,
        refresh_metrics=True,
        refresh_brief=True,
    )
    _broadcast(event, audience=AUDIENCE_OPERATIONS)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS)
    return jsonify({
        "queue": entry,
        "case": case,
        "event": event,
        "directives": directives,
    })


@app.delete("/api/queues/<queue_id>")
def delete_queue_entry(queue_id: str) -> Response:
    user = _authorized_user("operations")
    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Operations coordinator"
    actor = incoming.get("removed_by") or incoming.get("actor") or default_actor
    entry = _remove_queue_entry(queue_id)
    if not entry:
        return jsonify({"error": "unknown queue entry"}), 404

    case_id = entry.get("case_id")
    case = CASES.get(case_id)
    if case and case.get("visit_status") == entry.get("visit_status"):
        case["visit_status"] = entry.get("visit_status")

    activity_message = f"{entry.get('patient', case_id)}: removed from queue by {actor}"
    event = {
        "type": "queue.appointment_removed",
        "actor": actor,
        "case_id": case_id,
        "queue_id": queue_id,
        "activity": activity_message,
        "payload": {
            "queue_id": queue_id,
            "case": case,
        },
    }
    directives = _build_case_directives(
        case_id,
        refresh_case=True,
        refresh_queue=True,
        refresh_providers=True,
        refresh_metrics=True,
        refresh_brief=True,
    )
    _broadcast(event, audience=AUDIENCE_OPERATIONS)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/providers")
def create_provider() -> Response:
    user = _authorized_user("coverage", "operations")
    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Coverage supervisor"
    actor = incoming.get("created_by") or incoming.get("actor") or default_actor
    provider_id = incoming.get("id") or _generate_id("prv")
    provider = {
        "id": provider_id,
        "name": incoming.get("name") or "New provider",
        "availability": incoming.get("availability") or "",
        "status": incoming.get("status") or "available",
        "specialty": incoming.get("specialty") or "",
        "next_slot": incoming.get("next_slot") or "",
        "coverage_notes": incoming.get("coverage_notes") or "",
    }
    PROVIDERS[provider_id] = provider
    snapshot = _build_provider_snapshot(provider_id)

    activity_message = f"{provider['name']}: added to coverage roster by {actor}"
    event = {
        "type": "provider.created",
        "actor": actor,
        "activity": activity_message,
        "payload": {"provider_snapshot": snapshot},
    }
    directives = _build_refresh_directives("providers", "coverage_teams")
    _broadcast(event, audience=AUDIENCE_OPERATIONS_AND_COVERAGE)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS_AND_COVERAGE)
    return jsonify({"provider": snapshot, "event": event, "directives": directives})


@app.patch("/api/providers/<provider_id>")
def update_provider(provider_id: str) -> Response:
    user = _authorized_user("coverage", "operations")
    provider = PROVIDERS.get(provider_id)
    if not provider:
        return jsonify({"error": "unknown provider"}), 404

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Coverage supervisor"
    actor = incoming.get("updated_by") or incoming.get("actor") or default_actor

    for field in ["name", "availability", "status", "specialty", "next_slot", "coverage_notes"]:
        if field in incoming and incoming[field] is not None:
            provider[field] = incoming[field]

    snapshot = _build_provider_snapshot(provider_id)
    activity_message = f"{snapshot.get('name', provider_id)}: provider details updated by {actor}"
    event = {
        "type": "provider.updated",
        "actor": actor,
        "activity": activity_message,
        "payload": {"provider_snapshot": snapshot},
    }
    directives = _build_refresh_directives("providers", "coverage_teams")
    _broadcast(event, audience=AUDIENCE_OPERATIONS_AND_COVERAGE)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS_AND_COVERAGE)
    return jsonify({"provider": snapshot, "event": event, "directives": directives})


@app.delete("/api/providers/<provider_id>")
def delete_provider(provider_id: str) -> Response:
    user = _authorized_user("coverage", "operations")
    provider = PROVIDERS.pop(provider_id, None)
    if not provider:
        return jsonify({"error": "unknown provider"}), 404

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Coverage supervisor"
    actor = incoming.get("removed_by") or incoming.get("actor") or default_actor

    affected_cases: List[str] = []
    for entry in APPOINTMENT_QUEUES:
        if entry.get("assigned_provider_id") == provider_id:
            entry["assigned_provider_id"] = None
            entry["assigned_provider_name"] = None
            case_id = entry.get("case_id")
            if case_id:
                affected_cases.append(case_id)
                case = _ensure_case_structure(case_id)
                assigned = case.setdefault("care_team", {}).setdefault("assigned_provider", {})
                assigned["id"] = None
                assigned["name"] = None

    directives = _build_refresh_directives("providers", "queues", "operations_metrics", "operations_brief", "coverage_teams")
    for case_id in affected_cases:
        directives.append({"op": "refresh_item", "name": "case", "id": case_id})

    activity_message = f"{provider.get('name', provider_id)}: removed from roster by {actor}"
    event = {
        "type": "provider.removed",
        "actor": actor,
        "activity": activity_message,
        "payload": {
            "provider_id": provider_id,
            "affected_cases": affected_cases,
        },
    }
    _broadcast(event, audience=AUDIENCE_OPERATIONS_AND_COVERAGE)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS_AND_COVERAGE)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/coverage/teams")
def create_coverage_team() -> Response:
    user = _authorized_user("coverage", "operations")
    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Coverage supervisor"
    actor = incoming.get("created_by") or incoming.get("actor") or default_actor
    team_id = incoming.get("id") or _generate_id("cov")
    team = {
        "id": team_id,
        "name": incoming.get("name") or "Coverage pod",
        "shift_window": incoming.get("shift_window") or "",
        "handoff_channel": incoming.get("handoff_channel") or "",
        "primary_lead": incoming.get("primary_lead") or "",
        "support_roles": _normalize_string_list(incoming.get("support_roles")),
        "provider_ids": _normalize_provider_ids(incoming.get("provider_ids")),
        "coverage_notes": incoming.get("coverage_notes") or "",
    }
    COVERAGE_TEAMS.append(team)

    activity_message = f"{team['name']}: coverage pod added by {actor}"
    event = {
        "type": "coverage.team_created",
        "actor": actor,
        "activity": activity_message,
        "payload": {"coverage_team": team},
    }
    directives = _build_refresh_directives("coverage_teams")
    _broadcast(event, audience=AUDIENCE_COVERAGE_ONLY)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_COVERAGE_ONLY)
    return jsonify({"team": team, "event": event, "directives": directives})


@app.patch("/api/coverage/teams/<team_id>")
def update_coverage_team(team_id: str) -> Response:
    user = _authorized_user("coverage", "operations")
    located = _find_list_item(COVERAGE_TEAMS, team_id)
    if not located:
        return jsonify({"error": "unknown coverage team"}), 404
    index, team = located

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Coverage supervisor"
    actor = incoming.get("updated_by") or incoming.get("actor") or default_actor

    for field in ["name", "shift_window", "handoff_channel", "primary_lead", "coverage_notes"]:
        if field in incoming and incoming[field] is not None:
            team[field] = incoming[field]
    if "support_roles" in incoming:
        team["support_roles"] = _normalize_string_list(incoming.get("support_roles"))
    if "provider_ids" in incoming:
        team["provider_ids"] = _normalize_provider_ids(incoming.get("provider_ids"))

    COVERAGE_TEAMS[index] = team

    activity_message = f"{team.get('name', team_id)}: coverage pod updated by {actor}"
    event = {
        "type": "coverage.team_updated",
        "actor": actor,
        "activity": activity_message,
        "payload": {"coverage_team": team},
    }
    directives = _build_refresh_directives("coverage_teams")
    _broadcast(event, audience=AUDIENCE_COVERAGE_ONLY)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_COVERAGE_ONLY)
    return jsonify({"team": team, "event": event, "directives": directives})


@app.delete("/api/coverage/teams/<team_id>")
def delete_coverage_team(team_id: str) -> Response:
    user = _authorized_user("coverage", "operations")
    located = _find_list_item(COVERAGE_TEAMS, team_id)
    if not located:
        return jsonify({"error": "unknown coverage team"}), 404
    index, team = located
    COVERAGE_TEAMS.pop(index)

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Coverage supervisor"
    actor = incoming.get("removed_by") or incoming.get("actor") or default_actor

    activity_message = f"{team.get('name', team_id)}: coverage pod removed by {actor}"
    event = {
        "type": "coverage.team_removed",
        "actor": actor,
        "activity": activity_message,
        "payload": {"coverage_team": team},
    }
    directives = _build_refresh_directives("coverage_teams")
    _broadcast(event, audience=AUDIENCE_COVERAGE_ONLY)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_COVERAGE_ONLY)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/coverage/support-contacts")
def create_support_contact() -> Response:
    user = _authorized_user("coverage", "operations")
    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Coverage supervisor"
    actor = incoming.get("created_by") or incoming.get("actor") or default_actor
    contact_id = incoming.get("id") or _generate_id("support")
    contact = {
        "id": contact_id,
        "name": incoming.get("name") or "Support contact",
        "channel": incoming.get("channel") or "",
        "hours": incoming.get("hours") or "",
        "notes": incoming.get("notes") or "",
    }
    COVERAGE_SUPPORT_CONTACTS.append(contact)

    activity_message = f"{contact['name']}: quick contact added by {actor}"
    event = {
        "type": "coverage.support_contact_created",
        "actor": actor,
        "activity": activity_message,
        "payload": {"support_contact": contact},
    }
    directives = _build_refresh_directives("coverage_teams")
    _broadcast(event, audience=AUDIENCE_COVERAGE_ONLY)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_COVERAGE_ONLY)
    return jsonify({"contact": contact, "event": event, "directives": directives})


@app.patch("/api/coverage/support-contacts/<contact_id>")
def update_support_contact(contact_id: str) -> Response:
    user = _authorized_user("coverage", "operations")
    located = _find_list_item(COVERAGE_SUPPORT_CONTACTS, contact_id)
    if not located:
        return jsonify({"error": "unknown support contact"}), 404
    index, contact = located

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Coverage supervisor"
    actor = incoming.get("updated_by") or incoming.get("actor") or default_actor

    for field in ["name", "channel", "hours", "notes"]:
        if field in incoming and incoming[field] is not None:
            contact[field] = incoming[field]

    COVERAGE_SUPPORT_CONTACTS[index] = contact

    activity_message = f"{contact.get('name', contact_id)}: quick contact updated by {actor}"
    event = {
        "type": "coverage.support_contact_updated",
        "actor": actor,
        "activity": activity_message,
        "payload": {"support_contact": contact},
    }
    directives = _build_refresh_directives("coverage_teams")
    _broadcast(event, audience=AUDIENCE_COVERAGE_ONLY)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_COVERAGE_ONLY)
    return jsonify({"contact": contact, "event": event, "directives": directives})


@app.delete("/api/coverage/support-contacts/<contact_id>")
def delete_support_contact(contact_id: str) -> Response:
    user = _authorized_user("coverage", "operations")
    located = _find_list_item(COVERAGE_SUPPORT_CONTACTS, contact_id)
    if not located:
        return jsonify({"error": "unknown support contact"}), 404
    index, contact = located
    COVERAGE_SUPPORT_CONTACTS.pop(index)

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Coverage supervisor"
    actor = incoming.get("removed_by") or incoming.get("actor") or default_actor

    activity_message = f"{contact.get('name', contact_id)}: quick contact removed by {actor}"
    event = {
        "type": "coverage.support_contact_removed",
        "actor": actor,
        "activity": activity_message,
        "payload": {"support_contact": contact},
    }
    directives = _build_refresh_directives("coverage_teams")
    _broadcast(event, audience=AUDIENCE_COVERAGE_ONLY)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_COVERAGE_ONLY)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/operations/incidents")
def create_incident() -> Response:
    user = _authorized_user("operations", "briefing")
    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Briefing lead"
    actor = incoming.get("created_by") or incoming.get("actor") or default_actor
    incident_id = incoming.get("id") or _generate_id("incident")
    incident = {
        "id": incident_id,
        "ts": incoming.get("ts") or _now_iso(),
        "summary": incoming.get("summary") or "",
        "owner": incoming.get("owner") or actor,
    }
    OPERATIONS_INCIDENT_LOG.insert(0, incident)

    activity_message = f"Briefing incident logged by {actor}"
    event = {
        "type": "operations.incident_created",
        "actor": actor,
        "activity": activity_message,
        "payload": {"incident": incident},
    }
    directives = _build_refresh_directives("operations_brief")
    _broadcast(event, audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    return jsonify({"incident": incident, "event": event, "directives": directives})


@app.patch("/api/operations/incidents/<incident_id>")
def update_incident(incident_id: str) -> Response:
    user = _authorized_user("operations", "briefing")
    located = _find_list_item(OPERATIONS_INCIDENT_LOG, incident_id)
    if not located:
        return jsonify({"error": "unknown incident"}), 404
    index, incident = located

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Briefing lead"
    actor = incoming.get("updated_by") or incoming.get("actor") or default_actor

    for field in ["ts", "summary", "owner"]:
        if field in incoming and incoming[field] is not None:
            incident[field] = incoming[field]

    OPERATIONS_INCIDENT_LOG[index] = incident

    activity_message = f"Briefing incident updated by {actor}"
    event = {
        "type": "operations.incident_updated",
        "actor": actor,
        "activity": activity_message,
        "payload": {"incident": incident},
    }
    directives = _build_refresh_directives("operations_brief")
    _broadcast(event, audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    return jsonify({"incident": incident, "event": event, "directives": directives})


@app.delete("/api/operations/incidents/<incident_id>")
def delete_incident(incident_id: str) -> Response:
    user = _authorized_user("operations", "briefing")
    located = _find_list_item(OPERATIONS_INCIDENT_LOG, incident_id)
    if not located:
        return jsonify({"error": "unknown incident"}), 404
    index, incident = located
    OPERATIONS_INCIDENT_LOG.pop(index)

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Briefing lead"
    actor = incoming.get("removed_by") or incoming.get("actor") or default_actor

    activity_message = f"Briefing incident removed by {actor}"
    event = {
        "type": "operations.incident_removed",
        "actor": actor,
        "activity": activity_message,
        "payload": {"incident": incident},
    }
    directives = _build_refresh_directives("operations_brief")
    _broadcast(event, audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/operations/staffing")
def create_staffing_call() -> Response:
    user = _authorized_user("operations", "briefing")
    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Briefing lead"
    actor = incoming.get("created_by") or incoming.get("actor") or default_actor
    staffing_id = incoming.get("id") or _generate_id("staffing")
    staffing = {
        "id": staffing_id,
        "team": incoming.get("team") or "",
        "need": incoming.get("need") or "",
        "eta": incoming.get("eta") or "",
    }
    BRIEF_STAFFING_CALLS.insert(0, staffing)

    activity_message = f"Staffing call added by {actor}"
    event = {
        "type": "operations.staffing_created",
        "actor": actor,
        "activity": activity_message,
        "payload": {"staffing": staffing},
    }
    directives = _build_refresh_directives("operations_brief")
    _broadcast(event, audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    return jsonify({"staffing": staffing, "event": event, "directives": directives})


@app.patch("/api/operations/staffing/<staffing_id>")
def update_staffing_call(staffing_id: str) -> Response:
    user = _authorized_user("operations", "briefing")
    located = _find_list_item(BRIEF_STAFFING_CALLS, staffing_id)
    if not located:
        return jsonify({"error": "unknown staffing call"}), 404
    index, staffing = located

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Briefing lead"
    actor = incoming.get("updated_by") or incoming.get("actor") or default_actor

    for field in ["team", "need", "eta"]:
        if field in incoming and incoming[field] is not None:
            staffing[field] = incoming[field]

    BRIEF_STAFFING_CALLS[index] = staffing

    activity_message = f"Staffing call updated by {actor}"
    event = {
        "type": "operations.staffing_updated",
        "actor": actor,
        "activity": activity_message,
        "payload": {"staffing": staffing},
    }
    directives = _build_refresh_directives("operations_brief")
    _broadcast(event, audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    return jsonify({"staffing": staffing, "event": event, "directives": directives})


@app.delete("/api/operations/staffing/<staffing_id>")
def delete_staffing_call(staffing_id: str) -> Response:
    user = _authorized_user("operations", "briefing")
    located = _find_list_item(BRIEF_STAFFING_CALLS, staffing_id)
    if not located:
        return jsonify({"error": "unknown staffing call"}), 404
    index, staffing = located
    BRIEF_STAFFING_CALLS.pop(index)

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Briefing lead"
    actor = incoming.get("removed_by") or incoming.get("actor") or default_actor

    activity_message = f"Staffing call cleared by {actor}"
    event = {
        "type": "operations.staffing_removed",
        "actor": actor,
        "activity": activity_message,
        "payload": {"staffing": staffing},
    }
    directives = _build_refresh_directives("operations_brief")
    _broadcast(event, audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS_AND_BRIEFING)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/resources/playbooks")
def create_playbook() -> Response:
    user = _authorized_user("library", "operations")
    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Resource curator"
    actor = incoming.get("created_by") or incoming.get("actor") or default_actor
    playbook_id = incoming.get("id") or _generate_id("playbook")
    playbook = {
        "id": playbook_id,
        "title": incoming.get("title") or "New playbook",
        "updated_at": incoming.get("updated_at") or datetime.datetime.now().date().isoformat(),
        "owner": incoming.get("owner") or actor,
        "highlights": _normalize_string_list(incoming.get("highlights")) or [incoming.get("summary", "")],
    }
    playbook["highlights"] = [item for item in playbook.get("highlights", []) if item]
    RESOURCE_PLAYBOOKS.insert(0, playbook)

    activity_message = f"{playbook['title']}: playbook added by {actor}"
    event = {
        "type": "resources.playbook_created",
        "actor": actor,
        "activity": activity_message,
        "payload": {"playbook": playbook},
    }
    directives = _build_refresh_directives("resource_library")
    _broadcast(event, audience=AUDIENCE_LIBRARY_ONLY)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_LIBRARY_ONLY)
    return jsonify({"playbook": playbook, "event": event, "directives": directives})


@app.patch("/api/resources/playbooks/<playbook_id>")
def update_playbook(playbook_id: str) -> Response:
    user = _authorized_user("library", "operations")
    located = _find_list_item(RESOURCE_PLAYBOOKS, playbook_id)
    if not located:
        return jsonify({"error": "unknown playbook"}), 404
    index, playbook = located

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Resource curator"
    actor = incoming.get("updated_by") or incoming.get("actor") or default_actor

    for field in ["title", "updated_at", "owner"]:
        if field in incoming and incoming[field] is not None:
            playbook[field] = incoming[field]
    if "highlights" in incoming:
        highlights = _normalize_string_list(incoming.get("highlights"))
        if highlights:
            playbook["highlights"] = highlights

    RESOURCE_PLAYBOOKS[index] = playbook

    activity_message = f"{playbook.get('title', playbook_id)}: playbook updated by {actor}"
    event = {
        "type": "resources.playbook_updated",
        "actor": actor,
        "activity": activity_message,
        "payload": {"playbook": playbook},
    }
    directives = _build_refresh_directives("resource_library")
    _broadcast(event, audience=AUDIENCE_LIBRARY_ONLY)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_LIBRARY_ONLY)
    return jsonify({"playbook": playbook, "event": event, "directives": directives})


@app.delete("/api/resources/playbooks/<playbook_id>")
def delete_playbook(playbook_id: str) -> Response:
    user = _authorized_user("library", "operations")
    located = _find_list_item(RESOURCE_PLAYBOOKS, playbook_id)
    if not located:
        return jsonify({"error": "unknown playbook"}), 404
    index, playbook = located
    RESOURCE_PLAYBOOKS.pop(index)

    incoming = request.get_json(force=True, silent=True) or {}
    default_actor = user.get("name") or "Resource curator"
    actor = incoming.get("removed_by") or incoming.get("actor") or default_actor

    activity_message = f"{playbook.get('title', playbook_id)}: playbook removed by {actor}"
    event = {
        "type": "resources.playbook_removed",
        "actor": actor,
        "activity": activity_message,
        "payload": {"playbook": playbook},
    }
    directives = _build_refresh_directives("resource_library")
    _broadcast(event, audience=AUDIENCE_LIBRARY_ONLY)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_LIBRARY_ONLY)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/cases/<case_id>/vitals")
def update_vitals(case_id: str) -> Response:
    user = _authorized_user("operations")
    case = CASES.get(case_id)
    if not case:
        return jsonify({"error": "unknown case"}), 404
    incoming = request.get_json(force=True, silent=True) or {}
    vitals = incoming.get("vitals") or {}
    if not vitals:
        return jsonify({"error": "missing vitals"}), 400

    summary = case.setdefault("summary", {})
    summary.setdefault("last_vitals", {}).update(vitals)
    summary["last_updated"] = _now_iso()

    default_actor = user.get("name") or "Care coordinator"
    recorded_by = incoming.get("recorded_by") or default_actor
    patient_name = case.get("patient", {}).get("name", case_id)

    timeline_entry = _append_timeline(
        case,
        summary=f"Vitals refreshed: BP {summary['last_vitals'].get('bp', '—')} · HR {summary['last_vitals'].get('hr', '—')} · SpO₂ {summary['last_vitals'].get('spo2', '—')}",
        entered_by=recorded_by,
        type="vitals",
        details={"vitals": summary.get("last_vitals", {})},
    )

    event = {
        "type": "case.vitals_updated",
        "case_id": case_id,
        "actor": recorded_by,
        "activity": f"{patient_name}: vitals updated by {recorded_by}",
        "payload": {
            "summary": summary,
            "timeline": case.get("timeline", []),
        },
    }
    event["ts"] = timeline_entry["ts"]
    directives = _build_case_directives(
        case_id,
        refresh_case=True,
        refresh_metrics=True,
        refresh_brief=True,
    )
    _broadcast(event, audience=AUDIENCE_OPERATIONS)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/cases/<case_id>/handoff")
def add_handoff(case_id: str) -> Response:
    user = _authorized_user("operations")
    case = CASES.get(case_id)
    if not case:
        return jsonify({"error": "unknown case"}), 404
    incoming = request.get_json(force=True, silent=True) or {}
    note_text = incoming.get("note")
    default_author = user.get("name") or "Care coordinator"
    author = incoming.get("author") or default_author
    if not note_text:
        return jsonify({"error": "missing note"}), 400

    preview = case.setdefault("chart_preview", {})
    notes = preview.setdefault("recent_notes", [])
    entry = {
        "author": author,
        "entered_at": _now_iso(),
        "text": note_text,
    }
    notes.insert(0, entry)

    patient_name = case.get("patient", {}).get("name", case_id)
    activity = f"{patient_name}: handoff note added by {author}"

    timeline_entry = _append_timeline(
        case,
        summary=f"Handoff note added by {author}",
        entered_by=author,
        type="handoff",
        details={"note": note_text},
    )

    event = {
        "type": "case.handoff_added",
        "case_id": case_id,
        "actor": author,
        "activity": activity,
        "payload": {
            "chart_preview": preview,
            "timeline": case.get("timeline", []),
        },
    }
    event["ts"] = timeline_entry["ts"]
    directives = _build_case_directives(
        case_id,
        refresh_case=True,
        refresh_metrics=True,
        refresh_brief=True,
    )
    _broadcast(event, audience=AUDIENCE_OPERATIONS)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/cases/<case_id>/escalate")
def toggle_escalation(case_id: str) -> Response:
    user = _authorized_user("operations")
    incoming = request.get_json(force=True, silent=True) or {}
    escalate = incoming.get("escalation_flag")
    if escalate is None:
        return jsonify({"error": "missing escalation_flag"}), 400

    updated = None
    for entry in APPOINTMENT_QUEUES:
        if entry["case_id"] == case_id:
            entry["escalation_flag"] = bool(escalate)
            updated = entry
            break

    if updated is None:
        return jsonify({"error": "unknown case"}), 404

    case = CASES.get(case_id)
    patient_name = case.get("patient", {}).get("name", case_id) if case else case_id
    default_actor = user.get("name") or "Care coordinator"
    actor = incoming.get("actor") or default_actor
    status = "escalated" if updated["escalation_flag"] else "de-escalated"

    timeline_entry = None
    if case:
        timeline_entry = _append_timeline(
            case,
            summary=f"Escalation {status} by {actor}",
            entered_by=actor,
            type="escalation",
            details={"escalation_flag": updated["escalation_flag"]},
        )

    event = {
        "type": "queue.escalation_changed",
        "case_id": case_id,
        "actor": actor,
        "activity": f"{patient_name}: queue {status} by {actor}",
        "payload": {
            "escalation_flag": updated["escalation_flag"],
            "timeline": case.get("timeline", []) if case else None,
        },
    }
    if timeline_entry:
        event["ts"] = timeline_entry["ts"]
    directives = _build_case_directives(
        case_id,
        refresh_case=bool(case),
        refresh_queue=True,
        refresh_metrics=True,
        refresh_brief=True,
    )
    _broadcast(event, audience=AUDIENCE_OPERATIONS)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/cases/<case_id>/assign-provider")
def assign_provider(case_id: str) -> Response:
    user = _authorized_user("operations")
    case = CASES.get(case_id)
    if not case:
        return jsonify({"error": "unknown case"}), 404

    incoming = request.get_json(force=True, silent=True) or {}
    provider_id = incoming.get("provider_id")
    default_actor = user.get("name") or "Care coordinator"
    assigned_by = incoming.get("assigned_by") or default_actor

    previous_provider = case.get("care_team", {}).get("assigned_provider")
    previous_provider_id = previous_provider.get("id") if previous_provider else None

    patient_name = case.get("patient", {}).get("name", case_id)

    provider_snapshot = None
    previous_snapshot = None

    if provider_id:
        provider = PROVIDERS.get(provider_id)
        if not provider:
            return jsonify({"error": "unknown provider"}), 404
        case.setdefault("care_team", {})["assigned_provider"] = {
            "id": provider_id,
            "name": provider["name"],
        }
        assigned_name = provider["name"]
        activity_message = f"{patient_name}: routed to {assigned_name} by {assigned_by}"
    else:
        case.setdefault("care_team", {})["assigned_provider"] = None
        assigned_name = "Unassigned"
        activity_message = f"{patient_name}: assignment cleared by {assigned_by}"

    updated_queue = _update_queue_entry(
        case_id,
        assigned_provider_id=provider_id,
        assigned_provider_name=assigned_name if provider_id else None,
    )

    if provider_id:
        provider_snapshot = _build_provider_snapshot(provider_id)

    if previous_provider_id and previous_provider_id != provider_id:
        previous_snapshot = _build_provider_snapshot(previous_provider_id)

    timeline_entry = _append_timeline(
        case,
        summary=(
            f"Assigned to {assigned_name} by {assigned_by}"
            if provider_id
            else f"Provider assignment cleared by {assigned_by}"
        ),
        entered_by=assigned_by,
        type="assignment",
        details={"provider_id": provider_id, "provider_name": assigned_name},
    )

    event = {
        "type": "queue.provider_assigned",
        "case_id": case_id,
        "actor": assigned_by,
        "activity": activity_message,
        "payload": {
            "assigned_provider_id": provider_id,
            "assigned_provider_name": assigned_name if provider_id else None,
            "care_team": case.get("care_team", {}),
            "timeline": case.get("timeline", []),
            "visit_status": case.get("visit_status"),
        },
    }

    if provider_snapshot:
        event["payload"]["provider_snapshot"] = provider_snapshot
    if previous_snapshot:
        event["payload"]["previous_provider_snapshot"] = previous_snapshot
    if previous_provider_id and previous_provider_id == provider_id:
        event["payload"].setdefault("provider_snapshot", provider_snapshot)
    event["payload"]["queue"] = updated_queue
    event["ts"] = timeline_entry["ts"]

    directives = _build_case_directives(
        case_id,
        refresh_case=True,
        refresh_queue=True,
        refresh_providers=True,
        refresh_metrics=True,
        refresh_brief=True,
        refresh_coverage=True,
    )

    _broadcast(event, audience=AUDIENCE_OPERATIONS_AND_COVERAGE)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS_AND_COVERAGE)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/cases/<case_id>/status")
def update_status(case_id: str) -> Response:
    user = _authorized_user("operations")
    case = CASES.get(case_id)
    if not case:
        return jsonify({"error": "unknown case"}), 404

    incoming = request.get_json(force=True, silent=True) or {}
    status = incoming.get("status")
    default_actor = user.get("name") or "Care coordinator"
    updated_by = incoming.get("updated_by") or default_actor

    if status not in VISIT_STATUS_LABELS:
        return jsonify({"error": "invalid status"}), 400

    case["visit_status"] = status
    updated_queue = _update_queue_entry(case_id, visit_status=status)

    timeline_entry = _append_timeline(
        case,
        summary=f"Visit status marked '{VISIT_STATUS_LABELS[status]}' by {updated_by}",
        entered_by=updated_by,
        type="status",
        details={"visit_status": status},
    )

    patient_name = case.get("patient", {}).get("name", case_id)

    event = {
        "type": "queue.status_changed",
        "case_id": case_id,
        "actor": updated_by,
        "activity": f"{patient_name}: status → {VISIT_STATUS_LABELS[status]}",
        "payload": {
            "visit_status": status,
            "timeline": case.get("timeline", []),
            "queue": updated_queue,
            "case": {"visit_status": status},
        },
    }
    event["ts"] = timeline_entry["ts"]

    directives = _build_case_directives(
        case_id,
        refresh_case=True,
        refresh_queue=True,
        refresh_metrics=True,
        refresh_brief=True,
    )

    _broadcast(event, audience=AUDIENCE_OPERATIONS)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.post("/api/cases/<case_id>/contacts")
def log_contact(case_id: str) -> Response:
    user = _authorized_user("operations")
    case = CASES.get(case_id)
    if not case:
        return jsonify({"error": "unknown case"}), 404

    incoming = request.get_json(force=True, silent=True) or {}
    method = incoming.get("method") or "Phone call"
    contact = incoming.get("contact") or "Patient"
    summary = incoming.get("summary")
    default_actor = user.get("name") or "Care coordinator"
    logged_by = incoming.get("logged_by") or default_actor

    if not summary:
        return jsonify({"error": "missing summary"}), 400

    log_entry = {
        "ts": _now_iso(),
        "method": method,
        "contact": contact,
        "summary": summary,
        "logged_by": logged_by,
    }

    contact_log = case.setdefault("contact_log", [])
    contact_log.insert(0, log_entry)

    updated_queue = _update_queue_entry(case_id, last_contacted_at=log_entry["ts"])

    timeline_entry = _append_timeline(
        case,
        summary=f"Outbound {method.lower()} with {contact}",
        entered_by=logged_by,
        type="contact",
        details={"summary": summary},
    )

    patient_name = case.get("patient", {}).get("name", case_id)

    event = {
        "type": "case.contact_logged",
        "case_id": case_id,
        "actor": logged_by,
        "activity": f"{patient_name}: {method.lower()} logged by {logged_by}",
        "payload": {
            "contact_log": contact_log,
            "timeline": case.get("timeline", []),
            "queue": updated_queue,
        },
    }
    event["ts"] = timeline_entry["ts"]

    directives = _build_case_directives(
        case_id,
        refresh_case=True,
        refresh_queue=True,
        refresh_metrics=True,
        refresh_brief=True,
    )

    _broadcast(event, audience=AUDIENCE_OPERATIONS)
    _emit_directives(directives, source=event["type"], audience=AUDIENCE_OPERATIONS)
    return jsonify({"status": "ok", "event": event, "directives": directives})


@app.get("/stream")
def stream() -> Response:
    requested_user_id = request.args.get("user_id")
    subscriber_user = _get_user(requested_user_id)

    @stream_with_context
    def event_stream():
        q: queue.Queue = queue.Queue()
        subscriber = {
            "queue": q,
            "user": subscriber_user,
            "user_id": subscriber_user.get("id"),
            "roles": set(subscriber_user.get("roles", [])),
        }
        with _subscribers_lock:
            _subscribers.append(subscriber)
        try:
            while True:
                event = q.get()
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            with _subscribers_lock:
                try:
                    _subscribers.remove(subscriber)
                except ValueError:
                    pass

    headers = {
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream",
        "X-Accel-Buffering": "no",
    }
    return Response(event_stream(), headers=headers)


if __name__ == "__main__":
    app.run(debug=True)
