from __future__ import annotations

import csv
import html
import io
import json
import re
import secrets
import sqlite3
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


APP_DIR = Path(__file__).resolve().parent
DB_PATH = APP_DIR / "customer_database.sqlite3"
HOST = "127.0.0.1"
PORT = 8088

DEFAULT_COMPANY_SETTINGS = {
    "company_name": "Shanex",
    "website": "shanex.lk",
    "phone": "0772818661",
    "email": "hello@shanex.lk",
    "address": "Willauda Road, Waga North, Thummodara,\nSri Lanka",
}


def connect_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def setup_database() -> None:
    with connect_db() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_name TEXT NOT NULL,
                shop_name TEXT NOT NULL,
                contact_number TEXT NOT NULL DEFAULT '',
                exact_location TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                google_maps_link TEXT NOT NULL DEFAULT '',
                hardware_id TEXT NOT NULL DEFAULT '',
                installed_pc_details TEXT NOT NULL DEFAULT '',
                pc_count INTEGER NOT NULL DEFAULT 1,
                license_count INTEGER NOT NULL DEFAULT 1,
                license_price REAL NOT NULL DEFAULT 0,
                paid_amount REAL NOT NULL DEFAULT 0,
                plan_days INTEGER NOT NULL DEFAULT 30,
                plan_start_date TEXT NOT NULL,
                renewal_date TEXT NOT NULL,
                subscription_status TEXT NOT NULL DEFAULT 'active',
                license_key TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS company_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            )
            """
        )
        for key, value in DEFAULT_COMPANY_SETTINGS.items():
            db.execute(
                "INSERT OR IGNORE INTO company_settings (key, value) VALUES (?, ?)",
                (key, value),
            )
        migrate_customers_table(db)
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS pc_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                pc_name TEXT NOT NULL DEFAULT '',
                hardware_id TEXT NOT NULL DEFAULT '',
                windows_version TEXT NOT NULL DEFAULT '',
                processor TEXT NOT NULL DEFAULT '',
                ram TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS quotations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                quotation_number TEXT NOT NULL UNIQUE,
                quote_date TEXT NOT NULL,
                valid_until TEXT NOT NULL,
                license_count INTEGER NOT NULL,
                unit_price REAL NOT NULL,
                total_amount REAL NOT NULL,
                plan_days INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                quotation_id INTEGER,
                invoice_number TEXT NOT NULL UNIQUE,
                license_key TEXT NOT NULL,
                invoice_date TEXT NOT NULL,
                due_date TEXT NOT NULL,
                license_count INTEGER NOT NULL,
                unit_price REAL NOT NULL,
                total_amount REAL NOT NULL,
                paid_amount REAL NOT NULL,
                balance_amount REAL NOT NULL,
                payment_status TEXT NOT NULL DEFAULT 'unpaid',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE SET NULL
            )
            """
        )
        migrate_invoices_table(db)
        db.execute("CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(customer_name)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_customers_location ON customers(exact_location)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_customers_renewal ON customers(renewal_date)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_pc_assets_customer ON pc_assets(customer_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id)")


def migrate_customers_table(db: sqlite3.Connection) -> None:
    columns = {row["name"] for row in db.execute("PRAGMA table_info(customers)").fetchall()}
    today = date.today().isoformat()
    additions = {
        "contact_number": "TEXT NOT NULL DEFAULT ''",
        "latitude": "REAL",
        "longitude": "REAL",
        "google_maps_link": "TEXT NOT NULL DEFAULT ''",
        "hardware_id": "TEXT NOT NULL DEFAULT ''",
        "paid_amount": "REAL NOT NULL DEFAULT 0",
        "plan_start_date": f"TEXT NOT NULL DEFAULT '{today}'",
        "renewal_date": f"TEXT NOT NULL DEFAULT '{today}'",
        "subscription_status": "TEXT NOT NULL DEFAULT 'active'",
        "license_key": "TEXT NOT NULL DEFAULT ''",
    }
    for column, definition in additions.items():
        if column not in columns:
            db.execute(f"ALTER TABLE customers ADD COLUMN {column} {definition}")

    rows = db.execute(
        "SELECT id, plan_days, plan_start_date, renewal_date FROM customers"
    ).fetchall()
    for row in rows:
        start = parse_date(row["plan_start_date"]) or date.today()
        renewal = parse_date(row["renewal_date"])
        if not renewal or row["renewal_date"] == today:
            renewal = start + timedelta(days=int(row["plan_days"] or 30))
            db.execute(
                "UPDATE customers SET plan_start_date = ?, renewal_date = ? WHERE id = ?",
                (start.isoformat(), renewal.isoformat(), row["id"]),
            )


def migrate_invoices_table(db: sqlite3.Connection) -> None:
    columns = {row["name"] for row in db.execute("PRAGMA table_info(invoices)").fetchall()}
    additions = {
        "quotation_id": "INTEGER",
        "payment_status": "TEXT NOT NULL DEFAULT 'unpaid'",
    }
    for column, definition in additions.items():
        if column not in columns:
            db.execute(f"ALTER TABLE invoices ADD COLUMN {column} {definition}")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_company_settings() -> dict:
    settings = dict(DEFAULT_COMPANY_SETTINGS)
    with connect_db() as db:
        rows = db.execute("SELECT key, value FROM company_settings").fetchall()
    settings.update({row["key"]: row["value"] for row in rows})
    return settings


def update_company_settings(payload: dict) -> dict:
    allowed = set(DEFAULT_COMPANY_SETTINGS)
    cleaned = {
        key: str(payload.get(key, "")).strip()
        for key in allowed
        if key in payload
    }
    with connect_db() as db:
        for key, value in cleaned.items():
            db.execute(
                """
                INSERT INTO company_settings (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )
    return get_company_settings()


def parse_date(value: object) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def normalize_location(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^a-z0-9\u0d80-\u0dff]+", " ", value)
    return " ".join(value.split())


def parse_float(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_maps_coordinates(value: str) -> tuple[float | None, float | None]:
    if not value:
        return None, None
    patterns = [
        r"@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)",
        r"[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)",
        r"[?&]ll=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, value)
        if match:
            return float(match.group(1)), float(match.group(2))
    return None, None


def generate_license_key() -> str:
    year = date.today().year
    parts = [secrets.token_hex(2).upper() for _ in range(4)]
    return f"SHX-{year}-" + "-".join(parts)


def payment_status(total: float, paid: float) -> str:
    if paid <= 0:
        return "unpaid"
    if paid < total:
        return "partial"
    return "paid"


def customer_from_row(row: sqlite3.Row) -> dict:
    item = dict(row)
    item["pc_count"] = int(item["pc_count"])
    item["license_count"] = int(item["license_count"])
    item["license_price"] = float(item["license_price"])
    item["paid_amount"] = float(item["paid_amount"])
    item["latitude"] = parse_float(item.get("latitude"))
    item["longitude"] = parse_float(item.get("longitude"))
    item["plan_days"] = int(item["plan_days"])
    item["total_license_value"] = item["license_count"] * item["license_price"]
    item["balance_amount"] = max(item["total_license_value"] - item["paid_amount"], 0)
    item["payment_status"] = payment_status(item["total_license_value"], item["paid_amount"])
    renewal = parse_date(item["renewal_date"])
    item["days_to_renewal"] = (renewal - date.today()).days if renewal else None
    return item


def clean_customer_payload(payload: dict, partial: bool = False) -> dict:
    required_text = ["customer_name", "shop_name", "exact_location"]
    text_fields = required_text + [
        "contact_number",
        "google_maps_link",
        "hardware_id",
        "installed_pc_details",
        "notes",
        "plan_start_date",
        "renewal_date",
        "subscription_status",
        "license_key",
    ]
    number_fields = {
        "pc_count": int,
        "license_count": int,
        "license_price": float,
        "paid_amount": float,
        "latitude": float,
        "longitude": float,
        "plan_days": int,
    }
    defaults = {
        "pc_count": 1,
        "license_count": 1,
        "license_price": 0,
        "paid_amount": 0,
        "plan_days": 30,
    }
    cleaned: dict = {}

    for field in text_fields:
        if field in payload:
            cleaned[field] = str(payload.get(field, "")).strip()
        elif not partial and field in required_text:
            raise ValueError(f"{field} is required")

    for field in required_text:
        if field in cleaned and not cleaned[field]:
            raise ValueError(f"{field} is required")

    for field, caster in number_fields.items():
        if field not in payload:
            if partial:
                continue
            if field in {"latitude", "longitude"}:
                continue
            cleaned[field] = defaults[field]
            continue
        if field in {"latitude", "longitude"} and payload.get(field) in (None, ""):
            continue
        try:
            value = caster(payload.get(field, 0))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{field} must be a number") from exc
        if value < 0:
            raise ValueError(f"{field} cannot be negative")
        if field == "latitude" and not -90 <= value <= 90:
            raise ValueError("latitude must be between -90 and 90")
        if field == "longitude" and not -180 <= value <= 180:
            raise ValueError("longitude must be between -180 and 180")
        if field in {"pc_count", "license_count", "plan_days"} and value == 0:
            raise ValueError(f"{field} must be greater than zero")
        cleaned[field] = value

    if "google_maps_link" in cleaned and ("latitude" not in cleaned or "longitude" not in cleaned):
        lat, lng = parse_maps_coordinates(cleaned["google_maps_link"])
        if lat is not None and "latitude" not in cleaned:
            cleaned["latitude"] = lat
        if lng is not None and "longitude" not in cleaned:
            cleaned["longitude"] = lng

    if "subscription_status" in cleaned and cleaned["subscription_status"] not in {"active", "dropped"}:
        raise ValueError("subscription_status must be active or dropped")

    if "plan_start_date" in cleaned and not parse_date(cleaned["plan_start_date"]):
        raise ValueError("plan_start_date must be YYYY-MM-DD")
    if "renewal_date" in cleaned and not parse_date(cleaned["renewal_date"]):
        raise ValueError("renewal_date must be YYYY-MM-DD")

    if not partial:
        start = parse_date(cleaned.get("plan_start_date")) or date.today()
        plan_days = int(cleaned.get("plan_days", 30))
        renewal = parse_date(cleaned.get("renewal_date")) or (start + timedelta(days=plan_days))
        cleaned.setdefault("installed_pc_details", "")
        cleaned.setdefault("contact_number", "")
        cleaned.setdefault("google_maps_link", "")
        cleaned.setdefault("hardware_id", "")
        cleaned.setdefault("notes", "")
        cleaned.setdefault("subscription_status", "active")
        cleaned.setdefault("license_key", "")
        cleaned["plan_start_date"] = start.isoformat()
        cleaned["renewal_date"] = renewal.isoformat()

    return cleaned


def list_customers(query: str = "") -> list[dict]:
    query = query.strip()
    with connect_db() as db:
        if query:
            like = f"%{query}%"
            rows = db.execute(
                """
                SELECT * FROM customers
                WHERE customer_name LIKE ?
                   OR shop_name LIKE ?
                   OR contact_number LIKE ?
                   OR exact_location LIKE ?
                   OR google_maps_link LIKE ?
                   OR hardware_id LIKE ?
                   OR installed_pc_details LIKE ?
                   OR license_key LIKE ?
                   OR notes LIKE ?
                ORDER BY updated_at DESC, id DESC
                """,
                (like, like, like, like, like, like, like, like, like),
            ).fetchall()
        else:
            rows = db.execute("SELECT * FROM customers ORDER BY updated_at DESC, id DESC").fetchall()
    return [customer_from_row(row) for row in rows]


def get_customer(customer_id: int) -> dict:
    with connect_db() as db:
        row = db.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    if not row:
        raise KeyError("Customer not found")
    return customer_from_row(row)


def map_customers() -> list[dict]:
    return [
        customer
        for customer in list_customers()
        if customer.get("latitude") is not None and customer.get("longitude") is not None
    ]


def pc_from_row(row: sqlite3.Row) -> dict:
    return dict(row)


def list_customer_pcs(customer_id: int) -> list[dict]:
    with connect_db() as db:
        rows = db.execute(
            "SELECT * FROM pc_assets WHERE customer_id = ? ORDER BY updated_at DESC, id DESC",
            (customer_id,),
        ).fetchall()
    return [pc_from_row(row) for row in rows]


def clean_pc_payload(payload: dict) -> dict:
    fields = ["pc_name", "hardware_id", "windows_version", "processor", "ram", "notes"]
    cleaned = {field: str(payload.get(field, "")).strip() for field in fields}
    if not cleaned["pc_name"] and not cleaned["hardware_id"]:
        raise ValueError("PC name or hardware ID is required")
    return cleaned


def create_customer_pc(customer_id: int, payload: dict) -> dict:
    data = clean_pc_payload(payload)
    stamp = now_iso()
    with connect_db() as db:
        if not db.execute("SELECT id FROM customers WHERE id = ?", (customer_id,)).fetchone():
            raise KeyError("Customer not found")
        cursor = db.execute(
            """
            INSERT INTO pc_assets (
                customer_id, pc_name, hardware_id, windows_version, processor,
                ram, notes, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                customer_id,
                data["pc_name"],
                data["hardware_id"],
                data["windows_version"],
                data["processor"],
                data["ram"],
                data["notes"],
                stamp,
                stamp,
            ),
        )
        db.execute(
            "UPDATE customers SET pc_count = (SELECT COUNT(*) FROM pc_assets WHERE customer_id = ?), updated_at = ? WHERE id = ?",
            (customer_id, stamp, customer_id),
        )
        row = db.execute("SELECT * FROM pc_assets WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return pc_from_row(row)


def delete_customer_pc(customer_id: int, pc_id: int) -> None:
    stamp = now_iso()
    with connect_db() as db:
        cursor = db.execute(
            "DELETE FROM pc_assets WHERE id = ? AND customer_id = ?",
            (pc_id, customer_id),
        )
        if cursor.rowcount == 0:
            raise KeyError("PC not found")
        db.execute(
            "UPDATE customers SET pc_count = (SELECT COUNT(*) FROM pc_assets WHERE customer_id = ?), updated_at = ? WHERE id = ?",
            (customer_id, stamp, customer_id),
        )


def nearby_locations(location: str, exclude_id: int | None = None) -> list[dict]:
    normalized = normalize_location(location)
    if not normalized:
        return []

    with connect_db() as db:
        rows = db.execute(
            "SELECT id, customer_name, shop_name, exact_location FROM customers ORDER BY id DESC"
        ).fetchall()

    matches = []
    for row in rows:
        if exclude_id and int(row["id"]) == exclude_id:
            continue
        existing = normalize_location(row["exact_location"])
        if not existing:
            continue
        ratio = SequenceMatcher(None, normalized, existing).ratio()
        contains_match = normalized in existing or existing in normalized
        if contains_match or ratio >= 0.72:
            item = dict(row)
            item["match_score"] = round(ratio, 2)
            matches.append(item)
    return matches[:8]


def dashboard_stats() -> dict:
    today = date.today()
    month_start = today.replace(day=1).isoformat()
    next_30 = (today + timedelta(days=30)).isoformat()
    today_iso = today.isoformat()
    with connect_db() as db:
        row = db.execute(
            """
            SELECT
                COUNT(*) AS customers,
                COALESCE(SUM(CASE WHEN subscription_status = 'active' THEN 1 ELSE 0 END), 0) AS active_customers,
                COALESCE(SUM(CASE WHEN subscription_status = 'dropped' THEN 1 ELSE 0 END), 0) AS dropped_customers,
                COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS new_users,
                COALESCE(SUM(pc_count), 0) AS pcs,
                COALESCE(SUM(license_count), 0) AS licenses,
                COALESCE(SUM(paid_amount), 0) AS received_amount,
                COALESCE(SUM(CASE WHEN subscription_status = 'active' THEN license_count * license_price ELSE 0 END), 0) AS expected_income,
                COALESCE(SUM(CASE WHEN subscription_status = 'active' THEN MAX((license_count * license_price) - paid_amount, 0) ELSE 0 END), 0) AS pending_income,
                COALESCE(SUM(CASE WHEN subscription_status = 'active' AND renewal_date BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS upcoming_renewals,
                COALESCE(SUM(CASE WHEN subscription_status = 'active' AND renewal_date < ? THEN 1 ELSE 0 END), 0) AS overdue_renewals,
                COALESCE(SUM(CASE WHEN subscription_status = 'active' AND renewal_date BETWEEN ? AND ? THEN license_count * license_price ELSE 0 END), 0) AS renewal_expected_income
            FROM customers
            """,
            (month_start, today_iso, next_30, today_iso, today_iso, next_30),
        ).fetchone()
        renewals = db.execute(
            """
            SELECT *
            FROM customers
            WHERE subscription_status = 'active' AND renewal_date <= ?
            ORDER BY renewal_date ASC
            LIMIT 8
            """,
            (next_30,),
        ).fetchall()
    return {
        "customers": int(row["customers"]),
        "active_customers": int(row["active_customers"]),
        "dropped_customers": int(row["dropped_customers"]),
        "new_users": int(row["new_users"]),
        "pcs": int(row["pcs"]),
        "licenses": int(row["licenses"]),
        "received_amount": float(row["received_amount"]),
        "expected_income": float(row["expected_income"]),
        "pending_income": float(row["pending_income"]),
        "upcoming_renewals": int(row["upcoming_renewals"]),
        "overdue_renewals": int(row["overdue_renewals"]),
        "renewal_expected_income": float(row["renewal_expected_income"]),
        "renewals": [customer_from_row(renewal) for renewal in renewals],
    }


def create_customer(payload: dict) -> dict:
    data = clean_customer_payload(payload)
    stamp = now_iso()
    with connect_db() as db:
        cursor = db.execute(
            """
            INSERT INTO customers (
                customer_name, shop_name, contact_number, exact_location,
                latitude, longitude, google_maps_link, hardware_id, installed_pc_details,
                pc_count, license_count, license_price, paid_amount, plan_days,
                plan_start_date, renewal_date, subscription_status, license_key, notes,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data["customer_name"],
                data["shop_name"],
                data["contact_number"],
                data["exact_location"],
                data.get("latitude"),
                data.get("longitude"),
                data["google_maps_link"],
                data["hardware_id"],
                data["installed_pc_details"],
                data["pc_count"],
                data["license_count"],
                data["license_price"],
                data["paid_amount"],
                data["plan_days"],
                data["plan_start_date"],
                data["renewal_date"],
                data["subscription_status"],
                data["license_key"],
                data["notes"],
                stamp,
                stamp,
            ),
        )
        row = db.execute("SELECT * FROM customers WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return customer_from_row(row)


def update_customer(customer_id: int, payload: dict) -> dict:
    data = clean_customer_payload(payload, partial=True)
    if not data:
        raise ValueError("No fields to update")

    assignments = ", ".join(f"{field} = ?" for field in data)
    values = list(data.values()) + [now_iso(), customer_id]

    with connect_db() as db:
        existing = db.execute("SELECT id FROM customers WHERE id = ?", (customer_id,)).fetchone()
        if not existing:
            raise KeyError("Customer not found")
        db.execute(f"UPDATE customers SET {assignments}, updated_at = ? WHERE id = ?", values)
        row = db.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    return customer_from_row(row)


def delete_customer(customer_id: int) -> None:
    with connect_db() as db:
        db.execute("DELETE FROM pc_assets WHERE customer_id = ?", (customer_id,))
        db.execute("DELETE FROM invoices WHERE customer_id = ?", (customer_id,))
        db.execute("DELETE FROM quotations WHERE customer_id = ?", (customer_id,))
        cursor = db.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
        if cursor.rowcount == 0:
            raise KeyError("Customer not found")


def create_quotation(customer_id: int, payload: dict | None = None) -> dict:
    payload = payload or {}
    notes = str(payload.get("notes", "")).strip()
    with connect_db() as db:
        row = db.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
        if not row:
            raise KeyError("Customer not found")
        customer = customer_from_row(row)
        total = customer["license_count"] * customer["license_price"]
        quotation_number = f"QT-{date.today():%Y%m%d}-{secrets.token_hex(3).upper()}"
        cursor = db.execute(
            """
            INSERT INTO quotations (
                customer_id, quotation_number, quote_date, valid_until,
                license_count, unit_price, total_amount, plan_days, status,
                notes, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                customer_id,
                quotation_number,
                date.today().isoformat(),
                (date.today() + timedelta(days=7)).isoformat(),
                customer["license_count"],
                customer["license_price"],
                total,
                customer["plan_days"],
                "draft",
                notes,
                now_iso(),
            ),
        )
        quotation = db.execute("SELECT * FROM quotations WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return quotation_from_row(quotation, get_customer(customer_id))


def quotation_from_row(row: sqlite3.Row, customer: dict | None = None) -> dict:
    item = dict(row)
    item["license_count"] = int(item["license_count"])
    item["unit_price"] = float(item["unit_price"])
    item["total_amount"] = float(item["total_amount"])
    item["plan_days"] = int(item["plan_days"])
    if customer:
        item["customer"] = customer
    return item


def get_quotation(quotation_id: int) -> dict:
    with connect_db() as db:
        row = db.execute("SELECT * FROM quotations WHERE id = ?", (quotation_id,)).fetchone()
        if not row:
            raise KeyError("Quotation not found")
        customer = db.execute("SELECT * FROM customers WHERE id = ?", (row["customer_id"],)).fetchone()
    return quotation_from_row(row, customer_from_row(customer))


def create_invoice(customer_id: int, payload: dict | None = None, quotation_id: int | None = None) -> dict:
    payload = payload or {}
    paid_override = payload.get("paid_amount")
    notes = str(payload.get("notes", "")).strip()
    with connect_db() as db:
        row = db.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
        if not row:
            raise KeyError("Customer not found")
        customer = customer_from_row(row)
        license_key = customer["license_key"] or generate_license_key()
        if paid_override not in (None, ""):
            try:
                paid_amount = float(paid_override)
            except (TypeError, ValueError) as exc:
                raise ValueError("paid_amount must be a number") from exc
            if paid_amount < 0:
                raise ValueError("paid_amount cannot be negative")
            db.execute(
                "UPDATE customers SET paid_amount = ?, license_key = ?, updated_at = ? WHERE id = ?",
                (paid_amount, license_key, now_iso(), customer_id),
            )
            customer["paid_amount"] = paid_amount
            customer["license_key"] = license_key
        elif not customer["license_key"]:
            db.execute(
                "UPDATE customers SET license_key = ?, updated_at = ? WHERE id = ?",
                (license_key, now_iso(), customer_id),
            )
            customer["license_key"] = license_key

        total = customer["license_count"] * customer["license_price"]
        paid = customer["paid_amount"]
        balance = max(total - paid, 0)
        stamp = now_iso()
        invoice_number = f"INV-{date.today():%Y%m%d}-{secrets.token_hex(3).upper()}"
        cursor = db.execute(
            """
            INSERT INTO invoices (
                customer_id, quotation_id, invoice_number, license_key, invoice_date, due_date,
                license_count, unit_price, total_amount, paid_amount, balance_amount,
                payment_status, notes, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                customer_id,
                quotation_id,
                invoice_number,
                license_key,
                date.today().isoformat(),
                customer["renewal_date"],
                customer["license_count"],
                customer["license_price"],
                total,
                paid,
                balance,
                payment_status(total, paid),
                notes,
                stamp,
            ),
        )
        if quotation_id:
            db.execute("UPDATE quotations SET status = 'invoiced' WHERE id = ?", (quotation_id,))
        invoice = db.execute("SELECT * FROM invoices WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return invoice_from_row(invoice, get_customer(customer_id))


def create_invoice_from_quotation(quotation_id: int, payload: dict | None = None) -> dict:
    quotation = get_quotation(quotation_id)
    return create_invoice(quotation["customer_id"], payload, quotation_id)


def update_payment(customer_id: int, payload: dict) -> dict:
    try:
        paid_amount = float(payload.get("paid_amount", 0))
    except (TypeError, ValueError) as exc:
        raise ValueError("paid_amount must be a number") from exc
    if paid_amount < 0:
        raise ValueError("paid_amount cannot be negative")

    with connect_db() as db:
        row = db.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
        if not row:
            raise KeyError("Customer not found")
        customer = customer_from_row(row)
        status = payment_status(customer["total_license_value"], paid_amount)
        balance = max(customer["total_license_value"] - paid_amount, 0)
        db.execute(
            "UPDATE customers SET paid_amount = ?, updated_at = ? WHERE id = ?",
            (paid_amount, now_iso(), customer_id),
        )
        db.execute(
            """
            UPDATE invoices
            SET paid_amount = ?, balance_amount = ?, payment_status = ?
            WHERE customer_id = ?
            """,
            (paid_amount, balance, status, customer_id),
        )
    return get_customer(customer_id)


def invoice_from_row(row: sqlite3.Row, customer: dict | None = None) -> dict:
    item = dict(row)
    item["license_count"] = int(item["license_count"])
    item["unit_price"] = float(item["unit_price"])
    item["total_amount"] = float(item["total_amount"])
    item["paid_amount"] = float(item["paid_amount"])
    item["balance_amount"] = float(item["balance_amount"])
    item["payment_status"] = item.get("payment_status") or payment_status(
        item["total_amount"], item["paid_amount"]
    )
    if customer:
        item["customer"] = customer
    return item


def get_invoice(invoice_id: int) -> dict:
    with connect_db() as db:
        row = db.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
        if not row:
            raise KeyError("Invoice not found")
        customer = db.execute("SELECT * FROM customers WHERE id = ?", (row["customer_id"],)).fetchone()
    return invoice_from_row(row, customer_from_row(customer))


def customers_csv() -> bytes:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Customer Name",
            "Shop Name",
            "Contact Number",
            "Exact Location",
            "Hardware ID",
            "Installed PC Details",
            "PC Count",
            "License Count",
            "License Price",
            "Paid Amount",
            "Plan Days",
            "Plan Start Date",
            "Renewal Date",
            "Subscription Status",
            "License Key",
            "Payment Status",
            "Notes",
            "Created At",
            "Updated At",
        ]
    )
    for item in list_customers():
        writer.writerow(
            [
                item["customer_name"],
                item["shop_name"],
                item["contact_number"],
                item["exact_location"],
                item["hardware_id"],
                item["installed_pc_details"],
                item["pc_count"],
                item["license_count"],
                item["license_price"],
                item["paid_amount"],
                item["plan_days"],
                item["plan_start_date"],
                item["renewal_date"],
                item["subscription_status"],
                item["license_key"],
                item["payment_status"],
                item["notes"],
                item["created_at"],
                item["updated_at"],
            ]
        )
    return output.getvalue().encode("utf-8-sig")


def money(value: float) -> str:
    return f"Rs. {value:,.2f}"


def company_block(settings: dict) -> str:
    address = "<br>".join(html.escape(line) for line in settings["address"].splitlines())
    return f"""
      <div class="company">
        <strong>{html.escape(settings["company_name"])}</strong>
        <span>{html.escape(settings["website"])}</span>
        <span>{html.escape(settings["phone"])} | {html.escape(settings["email"])}</span>
        <span>{address}</span>
      </div>
    """


def document_page(title: str, body: str) -> str:
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 0; color: #18202a; background: #eef4f3; }}
    .page {{ max-width: 880px; margin: 24px auto; background: white; padding: 34px; border: 1px solid #dbe7e4; border-radius: 12px; box-shadow: 0 18px 40px rgba(15, 40, 48, .09); }}
    header {{ display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #087a73; padding-bottom: 18px; }}
    h1 {{ margin: 0; font-size: 32px; letter-spacing: 0; }}
    h2 {{ margin: 24px 0 10px; font-size: 18px; }}
    .muted {{ color: #627083; }}
    .company {{ display: grid; gap: 4px; color: #627083; margin-top: 10px; line-height: 1.4; }}
    .company strong {{ color: #087a73; font-size: 17px; }}
    .company span {{ display: block; }}
    .badge {{ display: inline-block; padding: 6px 10px; background: #e9f7f4; color: #075f5b; border-radius: 999px; font-weight: 700; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 14px; }}
    th, td {{ border-bottom: 1px solid #dde3eb; padding: 12px 8px; text-align: left; }}
    th {{ background: #edf3f5; }}
    .totals {{ margin-left: auto; width: 320px; }}
    .totals td:last-child {{ text-align: right; font-weight: 700; }}
    .license {{ font-size: 20px; font-weight: 700; letter-spacing: 1px; background: #f4f7f8; padding: 12px; border-radius: 6px; }}
    .actions {{ margin: 18px auto; max-width: 840px; display: flex; gap: 10px; }}
    button {{ border: 0; border-radius: 6px; padding: 10px 14px; background: #087a73; color: white; font-weight: 700; cursor: pointer; }}
    @media print {{ body {{ background: white; }} .page {{ margin: 0; border: 0; }} .actions {{ display: none; }} }}
  </style>
</head>
<body>
  <div class="actions"><button onclick="window.print()">Print / Save PDF</button></div>
  <div class="page">{body}</div>
</body>
</html>"""


def quotation_html(quotation: dict) -> str:
    customer = quotation["customer"]
    settings = get_company_settings()
    body = f"""
    <header>
      <div>
        <h1>Shanex Quotation</h1>
        <div class="muted">Software License Quotation</div>
        {company_block(settings)}
      </div>
      <div>
        <strong>{html.escape(quotation["quotation_number"])}</strong><br>
        <span class="muted">Date: {html.escape(quotation["quote_date"])}</span><br>
        <span class="muted">Valid Until: {html.escape(quotation["valid_until"])}</span><br>
        <span class="badge">{html.escape(quotation["status"].upper())}</span>
      </div>
    </header>

    <h2>Customer</h2>
    <strong>{html.escape(customer["customer_name"])}</strong><br>
    {html.escape(customer["shop_name"])}<br>
    <span class="muted">{html.escape(customer.get("contact_number", ""))}</span><br>
    <span class="muted">{html.escape(customer["exact_location"])}</span>

    <h2>License Details</h2>
    <div class="muted">Hardware ID: {html.escape(customer.get("hardware_id", "") or "-")}</div>
    <div class="muted">Plan: {quotation["plan_days"]} days</div>

    <table>
      <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
      <tbody>
        <tr>
          <td>Software license subscription</td>
          <td>{quotation["license_count"]}</td>
          <td>{money(quotation["unit_price"])}</td>
          <td>{money(quotation["total_amount"])}</td>
        </tr>
      </tbody>
    </table>

    <table class="totals">
      <tr><td>Quotation Total</td><td>{money(quotation["total_amount"])}</td></tr>
    </table>
    """
    return document_page(quotation["quotation_number"], body)


def invoice_html(invoice: dict) -> str:
    customer = invoice["customer"]
    settings = get_company_settings()
    status = "PAID" if invoice["balance_amount"] <= 0 else "BALANCE DUE"
    body = f"""
    <header>
      <div>
        <h1>Shanex Invoice</h1>
        <div class="muted">Software License Invoice</div>
        {company_block(settings)}
      </div>
      <div>
        <strong>{html.escape(invoice["invoice_number"])}</strong><br>
        <span class="muted">Date: {html.escape(invoice["invoice_date"])}</span><br>
        <span class="badge">{status}</span>
      </div>
    </header>

    <h2>Customer</h2>
    <strong>{html.escape(customer["customer_name"])}</strong><br>
    {html.escape(customer["shop_name"])}<br>
    <span class="muted">{html.escape(customer.get("contact_number", ""))}</span><br>
    <span class="muted">{html.escape(customer["exact_location"])}</span>

    <h2>License</h2>
    <div class="license">{html.escape(invoice["license_key"])}</div>
    <div class="muted">Hardware ID: {html.escape(customer.get("hardware_id", "") or "-")}</div>
    <div class="muted">Plan: {customer["plan_days"]} days | Renewal: {html.escape(customer["renewal_date"])}</div>

    <table>
      <thead>
        <tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>Software license subscription</td>
          <td>{invoice["license_count"]}</td>
          <td>{money(invoice["unit_price"])}</td>
          <td>{money(invoice["total_amount"])}</td>
        </tr>
      </tbody>
    </table>

    <table class="totals">
      <tr><td>Total</td><td>{money(invoice["total_amount"])}</td></tr>
      <tr><td>Paid</td><td>{money(invoice["paid_amount"])}</td></tr>
      <tr><td>Balance</td><td>{money(invoice["balance_amount"])}</td></tr>
    </table>
    """
    return document_page(invoice["invoice_number"], body)


PAGE_HTML = r"""
<!doctype html>
<html lang="si">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shanex Customer Database</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    :root {
      color-scheme: light;
      --ink: #162127;
      --muted: #64717d;
      --line: #dce7e4;
      --panel: #ffffff;
      --bg: #eef4f3;
      --brand: #087a73;
      --brand-dark: #075f5b;
      --danger: #b42318;
      --soft: #e8f7f3;
      --alert: #fff5e5;
      --shadow: 0 16px 42px rgba(16, 47, 54, .08);
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, "Noto Sans Sinhala", sans-serif; background: var(--bg); color: var(--ink); }
    header { background: #102f36; color: white; padding: 22px clamp(16px, 4vw, 44px); display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-bottom: 1px solid rgba(255,255,255,.14); }
    h1 { margin: 0; font-size: clamp(24px, 3vw, 36px); letter-spacing: 0; }
    header p { margin: 6px 0 0; color: #c8dcda; }
    main { padding: 24px clamp(12px, 3vw, 34px) 40px; max-width: 1540px; margin: 0 auto; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 14px; margin-bottom: 18px; }
    .stat { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 15px; min-height: 92px; box-shadow: var(--shadow); }
    .stat span { display: block; color: var(--muted); font-size: 13px; }
    .stat strong { display: block; font-size: 24px; margin-top: 6px; overflow-wrap: anywhere; }
    .layout { display: grid; grid-template-columns: minmax(340px, 430px) 1fr; gap: 18px; align-items: start; }
    .stack { display: grid; gap: 16px; }
    section { background: rgba(255,255,255,.96); border: 1px solid var(--line); border-radius: 8px; padding: 18px; box-shadow: var(--shadow); }
    h2 { margin: 0 0 14px; font-size: 20px; }
    label { display: block; font-weight: 700; font-size: 13px; margin: 11px 0 6px; }
    input, textarea, select { width: 100%; border: 1px solid #cbd9d6; border-radius: 8px; padding: 10px 11px; font: inherit; background: #fbfdfd; color: var(--ink); outline: none; }
    input:focus, textarea:focus, select:focus { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(8, 122, 115, .14); background: white; }
    textarea { min-height: 74px; resize: vertical; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .actions, .toolbar { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
    button, .link-button { border: 0; border-radius: 8px; padding: 10px 13px; font: inherit; font-weight: 700; cursor: pointer; background: var(--brand); color: white; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; min-height: 40px; transition: transform .12s ease, background .12s ease; }
    button:hover, .link-button:hover { background: var(--brand-dark); }
    button:active, .link-button:active { transform: translateY(1px); }
    button.secondary { background: #e7edf2; color: var(--ink); }
    button.secondary:hover { background: #d6e0e8; }
    button.danger { background: var(--danger); }
    button.danger:hover { background: #8f1d14; }
    .notice { display: none; margin-top: 10px; padding: 10px; border-radius: 6px; background: var(--alert); border: 1px solid #ffd596; color: #663c00; font-size: 14px; }
    .notice.show { display: block; }
    .renewals { margin-bottom: 16px; background: #f8fbfb; border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
    .renewal-list { display: grid; gap: 8px; }
    .renewal-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
    .renewal-item:last-child { border-bottom: 0; padding-bottom: 0; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: white; }
    table { width: 100%; min-width: 1180px; border-collapse: collapse; }
    th, td { padding: 11px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: #edf5f4; font-size: 13px; color: #334252; position: sticky; top: 0; }
    tbody tr:hover { background: #fbfdfd; }
    tr:last-child td { border-bottom: 0; }
    .muted { color: var(--muted); font-size: 13px; }
    .pill { display: inline-block; border-radius: 999px; background: var(--soft); color: #075f5b; padding: 4px 8px; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .pill.dropped { background: #ffe8e5; color: #8f1d14; }
    .row-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .row-actions button { min-height: 34px; padding: 7px 9px; }
    .empty { padding: 24px; text-align: center; color: var(--muted); }
    .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .settings-grid .wide { grid-column: 1 / -1; }
    .save-note { min-height: 18px; color: var(--brand); font-size: 13px; margin-top: 8px; }
    .erp-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .map-card { margin-bottom: 16px; overflow: hidden; }
    #customerMap { height: 380px; border-radius: 8px; border: 1px solid var(--line); background: #dfe9e7; }
    .pc-list { display: grid; gap: 8px; margin-top: 12px; }
    .pc-item { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: #fbfdfd; display: grid; gap: 6px; }
    .pc-item-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .section-kicker { color: var(--muted); font-size: 13px; margin: -8px 0 10px; }
    @media (max-width: 1080px) { .layout { grid-template-columns: 1fr; } .stats { grid-template-columns: repeat(2, minmax(140px, 1fr)); } }
    @media (max-width: 560px) { header { padding: 16px; } main { padding: 14px 10px 28px; } section { padding: 13px; } .grid2, .stats { grid-template-columns: 1fr; } .toolbar input { flex-basis: 100%; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Shanex Customer Database</h1>
      <p>Customers, subscriptions, renewals, payments, invoices, license keys.</p>
    </div>
    <a class="link-button" href="/export.csv">Export CSV</a>
  </header>
  <main>
    <div class="stats">
      <div class="stat"><span>Active Customers</span><strong id="statActive">0</strong></div>
      <div class="stat"><span>Renewals Next 30 Days</span><strong id="statRenewals">0</strong></div>
      <div class="stat"><span>Received Amount</span><strong id="statReceived">Rs. 0</strong></div>
      <div class="stat"><span>Expected Income</span><strong id="statExpected">Rs. 0</strong></div>
      <div class="stat"><span>Pending Income</span><strong id="statPending">Rs. 0</strong></div>
      <div class="stat"><span>Dropped Subscriptions</span><strong id="statDropped">0</strong></div>
      <div class="stat"><span>New Users This Month</span><strong id="statNewUsers">0</strong></div>
      <div class="stat"><span>Renewal Income</span><strong id="statRenewalIncome">Rs. 0</strong></div>
    </div>

    <div class="layout">
      <div class="stack">
      <section>
        <h2 id="formTitle">Add Customer</h2>
        <form id="customerForm">
          <input type="hidden" id="customerId">
          <label for="customerName">Customer Name</label>
          <input id="customerName" required placeholder="Ex: Nimal Perera">

          <label for="shopName">Shop / Business Name</label>
          <input id="shopName" required placeholder="Ex: Nimal Grocery">

          <label for="contactNumber">Contact Number</label>
          <input id="contactNumber" placeholder="Ex: 0771234567">

          <label for="exactLocation">Exact Location</label>
          <textarea id="exactLocation" required placeholder="Address, nearest junction, Google map note"></textarea>
          <div id="locationNotice" class="notice"></div>

          <label for="googleMapsLink">Google Maps Link</label>
          <input id="googleMapsLink" placeholder="Paste Google Maps link or enter coordinates below">

          <div class="grid2">
            <div><label for="latitude">Latitude</label><input id="latitude" type="number" step="0.000001" placeholder="6.927079"></div>
            <div><label for="longitude">Longitude</label><input id="longitude" type="number" step="0.000001" placeholder="79.861244"></div>
          </div>

          <label for="hardwareId">Hardware ID</label>
          <input id="hardwareId" placeholder="Customer PC hardware ID">

          <label for="pcDetails">Installed PC Details</label>
          <textarea id="pcDetails" placeholder="CPU/RAM/Windows, PC names, serials, any notes"></textarea>

          <div class="grid2">
            <div><label for="pcCount">PC Count</label><input id="pcCount" type="number" min="1" value="1" required></div>
            <div><label for="licenseCount">License Count</label><input id="licenseCount" type="number" min="1" value="1" required></div>
            <div><label for="licensePrice">One License Price</label><input id="licensePrice" type="number" min="0" step="0.01" value="0" required></div>
            <div><label for="paidAmount">Paid Amount</label><input id="paidAmount" type="number" min="0" step="0.01" value="0" required></div>
            <div><label for="planDays">Plan Days</label><input id="planDays" type="number" min="1" value="30" required></div>
            <div><label for="status">Subscription</label><select id="status"><option value="active">Active</option><option value="dropped">Dropped</option></select></div>
            <div><label for="planStart">Plan Start</label><input id="planStart" type="date" required></div>
            <div><label for="renewalDate">Renewal Date</label><input id="renewalDate" type="date" required></div>
          </div>

          <label for="licenseKey">License Key</label>
          <input id="licenseKey" placeholder="Auto generated when invoice is created">

          <label for="notes">Notes</label>
          <textarea id="notes" placeholder="Payment, renewal, support notes"></textarea>

          <div class="actions">
            <button type="submit" id="saveButton">Save Customer</button>
            <button type="button" class="secondary" id="resetButton">Clear</button>
          </div>
        </form>
      </section>

      <section>
        <div class="erp-title">
          <h2>Customer PCs</h2>
          <span id="pcCustomerName" class="pill">Select customer</span>
        </div>
        <p class="section-kicker">Customer එක save කරලා table එකේ PCs button එක click කරලා PC details add කරන්න.</p>
        <form id="pcForm">
          <div class="grid2">
            <div><label for="pcName">PC Name</label><input id="pcName" placeholder="Counter PC / Back Office"></div>
            <div><label for="pcHardwareId">Hardware ID</label><input id="pcHardwareId" placeholder="HW-XXXX"></div>
            <div><label for="pcWindows">Windows</label><input id="pcWindows" placeholder="Windows 11 Pro"></div>
            <div><label for="pcRam">RAM</label><input id="pcRam" placeholder="8GB"></div>
          </div>
          <label for="pcProcessor">Processor</label>
          <input id="pcProcessor" placeholder="Intel i5 / Ryzen 5">
          <label for="pcNotes">PC Notes</label>
          <textarea id="pcNotes" placeholder="Any install/support notes"></textarea>
          <div class="actions">
            <button type="submit">Add PC</button>
          </div>
        </form>
        <div id="pcList" class="pc-list"></div>
      </section>

      <section>
        <h2>Company Details</h2>
        <form id="settingsForm">
          <div class="settings-grid">
            <div>
              <label for="companyName">Company Name</label>
              <input id="companyName" placeholder="Shanex">
            </div>
            <div>
              <label for="companyWebsite">Website</label>
              <input id="companyWebsite" placeholder="shanex.lk">
            </div>
            <div>
              <label for="companyPhone">Phone</label>
              <input id="companyPhone" placeholder="0772818661">
            </div>
            <div>
              <label for="companyEmail">Email</label>
              <input id="companyEmail" placeholder="hello@shanex.lk">
            </div>
            <div class="wide">
              <label for="companyAddress">Address</label>
              <textarea id="companyAddress" placeholder="Willauda Road, Waga North, Thummodara, Sri Lanka"></textarea>
            </div>
          </div>
          <div class="actions">
            <button type="submit">Save Company Details</button>
          </div>
          <div id="settingsNote" class="save-note"></div>
        </form>
      </section>
      </div>

      <section>
        <h2>ERP Dashboard</h2>
        <div class="map-card">
          <div class="erp-title">
            <strong>Customer Map</strong>
            <span class="muted">Sri Lanka customer location pins</span>
          </div>
          <div id="customerMap" style="margin-top: 10px;"></div>
        </div>
        <div class="renewals">
          <strong>Upcoming / overdue renewals</strong>
          <div id="renewalList" class="renewal-list" style="margin-top: 10px;"></div>
        </div>
        <div class="toolbar">
          <input id="searchBox" placeholder="Search name, shop, contact, hardware ID, location, license key">
          <button class="secondary" id="refreshButton">Refresh</button>
        </div>
        <div class="table-wrap" style="margin-top: 14px;">
          <table>
            <thead>
              <tr>
                <th>Customer / Shop</th>
                <th>Location</th>
                <th>Hardware / PC</th>
                <th>Licenses</th>
                <th>Paid / Balance</th>
                <th>Renewal</th>
                <th>Status</th>
                <th>License Key</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="customerRows"></tbody>
          </table>
          <div id="emptyState" class="empty" hidden>No customers saved yet.</div>
        </div>
      </section>
    </div>
  </main>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const form = document.querySelector("#customerForm");
    const settingsForm = document.querySelector("#settingsForm");
    const pcForm = document.querySelector("#pcForm");
    const rows = document.querySelector("#customerRows");
    const emptyState = document.querySelector("#emptyState");
    const notice = document.querySelector("#locationNotice");
    const fields = {
      id: document.querySelector("#customerId"),
      customer_name: document.querySelector("#customerName"),
      shop_name: document.querySelector("#shopName"),
      contact_number: document.querySelector("#contactNumber"),
      exact_location: document.querySelector("#exactLocation"),
      google_maps_link: document.querySelector("#googleMapsLink"),
      latitude: document.querySelector("#latitude"),
      longitude: document.querySelector("#longitude"),
      hardware_id: document.querySelector("#hardwareId"),
      installed_pc_details: document.querySelector("#pcDetails"),
      pc_count: document.querySelector("#pcCount"),
      license_count: document.querySelector("#licenseCount"),
      license_price: document.querySelector("#licensePrice"),
      paid_amount: document.querySelector("#paidAmount"),
      plan_days: document.querySelector("#planDays"),
      plan_start_date: document.querySelector("#planStart"),
      renewal_date: document.querySelector("#renewalDate"),
      subscription_status: document.querySelector("#status"),
      license_key: document.querySelector("#licenseKey"),
      notes: document.querySelector("#notes"),
    };
    const settingsFields = {
      company_name: document.querySelector("#companyName"),
      website: document.querySelector("#companyWebsite"),
      phone: document.querySelector("#companyPhone"),
      email: document.querySelector("#companyEmail"),
      address: document.querySelector("#companyAddress"),
    };
    const pcFields = {
      pc_name: document.querySelector("#pcName"),
      hardware_id: document.querySelector("#pcHardwareId"),
      windows_version: document.querySelector("#pcWindows"),
      processor: document.querySelector("#pcProcessor"),
      ram: document.querySelector("#pcRam"),
      notes: document.querySelector("#pcNotes"),
    };

    const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" });
    let customers = [];
    let selectedCustomerId = null;
    let locationTimer = null;
    let map = null;
    let mapLayer = null;

    function todayText() {
      return new Date().toISOString().slice(0, 10);
    }

    function addDays(dateText, days) {
      const current = dateText ? new Date(`${dateText}T00:00:00`) : new Date();
      current.setDate(current.getDate() + Number(days || 0));
      return current.toISOString().slice(0, 10);
    }

    function payloadFromForm() {
      return {
        customer_name: fields.customer_name.value,
        shop_name: fields.shop_name.value,
        contact_number: fields.contact_number.value,
        exact_location: fields.exact_location.value,
        google_maps_link: fields.google_maps_link.value,
        latitude: fields.latitude.value === "" ? "" : Number(fields.latitude.value),
        longitude: fields.longitude.value === "" ? "" : Number(fields.longitude.value),
        hardware_id: fields.hardware_id.value,
        installed_pc_details: fields.installed_pc_details.value,
        pc_count: Number(fields.pc_count.value),
        license_count: Number(fields.license_count.value),
        license_price: Number(fields.license_price.value),
        paid_amount: Number(fields.paid_amount.value),
        plan_days: Number(fields.plan_days.value),
        plan_start_date: fields.plan_start_date.value,
        renewal_date: fields.renewal_date.value,
        subscription_status: fields.subscription_status.value,
        license_key: fields.license_key.value,
        notes: fields.notes.value,
      };
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[char]));
    }

    async function api(path, options = {}) {
      const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
      const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
      if (!response.ok) throw new Error(data?.error || "Request failed");
      return data;
    }

    async function loadStats() {
      const stats = await api("/api/stats");
      document.querySelector("#statActive").textContent = stats.active_customers;
      document.querySelector("#statRenewals").textContent = `${stats.upcoming_renewals} (${stats.overdue_renewals} overdue)`;
      document.querySelector("#statReceived").textContent = money.format(stats.received_amount);
      document.querySelector("#statExpected").textContent = money.format(stats.expected_income);
      document.querySelector("#statPending").textContent = money.format(stats.pending_income);
      document.querySelector("#statDropped").textContent = stats.dropped_customers;
      document.querySelector("#statNewUsers").textContent = stats.new_users;
      document.querySelector("#statRenewalIncome").textContent = money.format(stats.renewal_expected_income);
      renderRenewals(stats.renewals);
    }

    async function loadCompanySettings() {
      const settings = await api("/api/company-settings");
      for (const key of Object.keys(settingsFields)) {
        settingsFields[key].value = settings[key] || "";
      }
    }

    async function saveCompanySettings(event) {
      event.preventDefault();
      const payload = {};
      for (const key of Object.keys(settingsFields)) {
        payload[key] = settingsFields[key].value;
      }
      await api("/api/company-settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const note = document.querySelector("#settingsNote");
      note.textContent = "Company details saved.";
      setTimeout(() => { note.textContent = ""; }, 2200);
    }

    function renderRenewals(renewals) {
      const list = document.querySelector("#renewalList");
      if (!renewals.length) {
        list.innerHTML = `<div class="muted">No renewals in the next 30 days.</div>`;
        return;
      }
      list.innerHTML = renewals.map(item => `
        <div class="renewal-item">
          <div>
            <strong>${escapeHtml(item.shop_name)}</strong>
            <div class="muted">${escapeHtml(item.customer_name)} | ${item.renewal_date} | ${item.days_to_renewal} days</div>
          </div>
          <span class="pill">${money.format(item.total_license_value)}</span>
        </div>
      `).join("");
    }

    async function loadCustomers() {
      const q = encodeURIComponent(document.querySelector("#searchBox").value.trim());
      customers = await api(`/api/customers?q=${q}`);
      renderRows();
      await loadStats();
      await loadMapCustomers();
    }

    function googleMapsUrl(item) {
      if (item.google_maps_link) return item.google_maps_link;
      if (item.latitude !== null && item.longitude !== null) {
        return `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`;
      }
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.exact_location)}`;
    }

    async function loadMapCustomers() {
      const items = await api("/api/map-customers");
      if (!window.L) return;
      if (!map) {
        map = L.map("customerMap").setView([7.8731, 80.7718], 7);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);
        mapLayer = L.layerGroup().addTo(map);
      }
      mapLayer.clearLayers();
      const bounds = [];
      for (const item of items) {
        const latlng = [item.latitude, item.longitude];
        bounds.push(latlng);
        L.marker(latlng).addTo(mapLayer).bindPopup(`
          <strong>${escapeHtml(item.shop_name)}</strong><br>
          ${escapeHtml(item.customer_name)}<br>
          <span>${escapeHtml(item.contact_number || "")}</span><br>
          <a href="${googleMapsUrl(item)}" target="_blank">Open in Google Maps</a>
        `);
      }
      if (bounds.length) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
      setTimeout(() => map.invalidateSize(), 100);
    }

    function renderRows() {
      rows.innerHTML = "";
      emptyState.hidden = customers.length > 0;
      for (const item of customers) {
        const tr = document.createElement("tr");
        const statusClass = item.subscription_status === "dropped" ? "pill dropped" : "pill";
        tr.innerHTML = `
          <td><strong>${escapeHtml(item.customer_name)}</strong><div class="muted">${escapeHtml(item.shop_name)}</div><div class="muted">${escapeHtml(item.contact_number || "-")}</div></td>
          <td>${escapeHtml(item.exact_location)}</td>
          <td><strong>${escapeHtml(item.hardware_id || "-")}</strong><div class="muted">${escapeHtml(item.installed_pc_details || "-")}</div><div class="muted">PCs: ${item.pc_count}</div></td>
          <td><span class="pill">${item.license_count}</span><div class="muted">Total ${money.format(item.total_license_value)}</div></td>
          <td>${money.format(item.paid_amount)}<div class="muted">Balance ${money.format(item.balance_amount)}</div><span class="pill">${item.payment_status}</span></td>
          <td>${item.renewal_date}<div class="muted">${item.plan_days} days plan</div></td>
          <td><span class="${statusClass}">${item.subscription_status}</span></td>
          <td>${escapeHtml(item.license_key || "-")}</td>
          <td>
            <div class="row-actions">
              <button class="secondary" data-edit="${item.id}">Edit</button>
              <button class="secondary" data-pcs="${item.id}">PCs</button>
              <button class="secondary" data-quote="${item.id}">Quote</button>
              <button data-invoice="${item.id}">Invoice</button>
              <button class="secondary" data-payment="${item.id}">Payment</button>
              <button class="danger" data-delete="${item.id}">Delete</button>
            </div>
          </td>
        `;
        rows.appendChild(tr);
      }
    }

    function resetForm() {
      form.reset();
      fields.id.value = "";
      fields.pc_count.value = 1;
      fields.license_count.value = 1;
      fields.license_price.value = 0;
      fields.paid_amount.value = 0;
      fields.plan_days.value = 30;
      fields.plan_start_date.value = todayText();
      fields.renewal_date.value = addDays(fields.plan_start_date.value, fields.plan_days.value);
      fields.subscription_status.value = "active";
      notice.classList.remove("show");
      document.querySelector("#formTitle").textContent = "Add Customer";
      document.querySelector("#saveButton").textContent = "Save Customer";
    }

    function editCustomer(id) {
      const item = customers.find(customer => customer.id === id);
      if (!item) return;
      for (const key of Object.keys(fields)) {
        if (key === "id") fields[key].value = item.id;
        else fields[key].value = item[key] ?? "";
      }
      document.querySelector("#formTitle").textContent = "Edit Customer";
      document.querySelector("#saveButton").textContent = "Update Customer";
      window.scrollTo({ top: 0, behavior: "smooth" });
      checkLocation();
    }

    function pcPayloadFromForm() {
      const payload = {};
      for (const key of Object.keys(pcFields)) payload[key] = pcFields[key].value;
      return payload;
    }

    function resetPcForm() {
      pcForm.reset();
    }

    async function openCustomerPcs(customerId) {
      selectedCustomerId = customerId;
      const item = customers.find(customer => customer.id === customerId);
      document.querySelector("#pcCustomerName").textContent = item ? item.shop_name : `Customer #${customerId}`;
      await loadCustomerPcs();
      document.querySelector("#pcForm").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function loadCustomerPcs() {
      const list = document.querySelector("#pcList");
      if (!selectedCustomerId) {
        list.innerHTML = `<div class="muted">Select a customer to manage PCs.</div>`;
        return;
      }
      const pcs = await api(`/api/customers/${selectedCustomerId}/pcs`);
      if (!pcs.length) {
        list.innerHTML = `<div class="muted">No PCs added for this customer yet.</div>`;
        return;
      }
      list.innerHTML = pcs.map(pc => `
        <div class="pc-item">
          <div class="pc-item-head">
            <strong>${escapeHtml(pc.pc_name || "Unnamed PC")}</strong>
            <button class="danger" data-delete-pc="${pc.id}">Delete</button>
          </div>
          <div class="muted">Hardware ID: ${escapeHtml(pc.hardware_id || "-")}</div>
          <div class="muted">${escapeHtml(pc.windows_version || "-")} | ${escapeHtml(pc.processor || "-")} | ${escapeHtml(pc.ram || "-")}</div>
          <div>${escapeHtml(pc.notes || "")}</div>
        </div>
      `).join("");
    }

    async function checkLocation() {
      const location = fields.exact_location.value.trim();
      if (location.length < 4) {
        notice.classList.remove("show");
        return;
      }
      const exclude = fields.id.value ? `&exclude_id=${fields.id.value}` : "";
      const matches = await api(`/api/location-check?location=${encodeURIComponent(location)}${exclude}`);
      if (!matches.length) {
        notice.classList.remove("show");
        return;
      }
      notice.innerHTML = `<strong>Warning:</strong> similar/nearby location already exists:<br>${matches
        .map(item => `${escapeHtml(item.shop_name)} - ${escapeHtml(item.exact_location)}`)
        .join("<br>")}`;
      notice.classList.add("show");
    }

    async function createInvoice(customerId) {
      const item = customers.find(customer => customer.id === customerId);
      const paid = prompt("Paid amount for this license/invoice:", item ? item.paid_amount : "0");
      if (paid === null) return;
      const invoice = await api(`/api/customers/${customerId}/invoice`, {
        method: "POST",
        body: JSON.stringify({ paid_amount: Number(paid) }),
      });
      await loadCustomers();
      window.open(`/invoice/${invoice.id}`, "_blank");
    }

    async function createQuotation(customerId) {
      const quotation = await api(`/api/customers/${customerId}/quotation`, { method: "POST", body: JSON.stringify({}) });
      await loadCustomers();
      window.open(`/quotation/${quotation.id}`, "_blank");
    }

    async function updatePaymentStatus(customerId) {
      const item = customers.find(customer => customer.id === customerId);
      const paid = prompt("Update paid amount:", item ? item.paid_amount : "0");
      if (paid === null) return;
      await api(`/api/customers/${customerId}/payment`, {
        method: "PUT",
        body: JSON.stringify({ paid_amount: Number(paid) }),
      });
      await loadCustomers();
    }

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const id = fields.id.value;
      const method = id ? "PUT" : "POST";
      const path = id ? `/api/customers/${id}` : "/api/customers";
      try {
        await api(path, { method, body: JSON.stringify(payloadFromForm()) });
        resetForm();
        await loadCustomers();
      } catch (error) {
        alert(error.message);
      }
    });

    rows.addEventListener("click", async event => {
      const editId = event.target.dataset.edit;
      const pcsId = event.target.dataset.pcs;
      const quoteId = event.target.dataset.quote;
      const invoiceId = event.target.dataset.invoice;
      const paymentId = event.target.dataset.payment;
      const deleteId = event.target.dataset.delete;
      if (editId) editCustomer(Number(editId));
      if (pcsId) openCustomerPcs(Number(pcsId));
      if (quoteId) createQuotation(Number(quoteId));
      if (invoiceId) createInvoice(Number(invoiceId));
      if (paymentId) updatePaymentStatus(Number(paymentId));
      if (deleteId && confirm("Delete this customer?")) {
        await api(`/api/customers/${deleteId}`, { method: "DELETE" });
        await loadCustomers();
      }
    });

    pcForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (!selectedCustomerId) {
        alert("Select a customer first.");
        return;
      }
      await api(`/api/customers/${selectedCustomerId}/pcs`, {
        method: "POST",
        body: JSON.stringify(pcPayloadFromForm()),
      });
      resetPcForm();
      await loadCustomerPcs();
      await loadCustomers();
    });

    document.querySelector("#pcList").addEventListener("click", async event => {
      const pcId = event.target.dataset.deletePc;
      if (!pcId || !selectedCustomerId) return;
      if (!confirm("Delete this PC?")) return;
      await api(`/api/customers/${selectedCustomerId}/pcs/${pcId}`, { method: "DELETE" });
      await loadCustomerPcs();
      await loadCustomers();
    });

    fields.exact_location.addEventListener("input", () => {
      clearTimeout(locationTimer);
      locationTimer = setTimeout(checkLocation, 350);
    });
    fields.plan_start_date.addEventListener("change", () => {
      fields.renewal_date.value = addDays(fields.plan_start_date.value, fields.plan_days.value);
    });
    fields.plan_days.addEventListener("input", () => {
      fields.renewal_date.value = addDays(fields.plan_start_date.value, fields.plan_days.value);
    });
    document.querySelector("#searchBox").addEventListener("input", () => {
      clearTimeout(locationTimer);
      locationTimer = setTimeout(loadCustomers, 250);
    });
    document.querySelector("#refreshButton").addEventListener("click", loadCustomers);
    document.querySelector("#resetButton").addEventListener("click", resetForm);
    settingsForm.addEventListener("submit", saveCompanySettings);

    resetForm();
    loadCustomerPcs();
    loadCompanySettings();
    loadCustomers();
  </script>
</body>
</html>
"""


class CustomerAppHandler(BaseHTTPRequestHandler):
    server_version = "ShanexCustomerDB/2.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_text(PAGE_HTML, "text/html; charset=utf-8")
            return
        if parsed.path == "/api/customers":
            query = parse_qs(parsed.query).get("q", [""])[0]
            self.send_json(list_customers(query))
            return
        if parsed.path == "/api/map-customers":
            self.send_json(map_customers())
            return
        match = re.fullmatch(r"/api/customers/(\d+)/pcs", parsed.path)
        if match:
            try:
                get_customer(int(match.group(1)))
                self.send_json(list_customer_pcs(int(match.group(1))))
            except KeyError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            return
        if parsed.path == "/api/stats":
            self.send_json(dashboard_stats())
            return
        if parsed.path == "/api/company-settings":
            self.send_json(get_company_settings())
            return
        if parsed.path == "/api/location-check":
            params = parse_qs(parsed.query)
            location = params.get("location", [""])[0]
            exclude_id = params.get("exclude_id", [None])[0]
            self.send_json(nearby_locations(location, int(exclude_id) if exclude_id else None))
            return
        match = re.fullmatch(r"/invoice/(\d+)", parsed.path)
        if match:
            try:
                self.send_text(invoice_html(get_invoice(int(match.group(1)))), "text/html; charset=utf-8")
            except KeyError:
                self.send_error(HTTPStatus.NOT_FOUND, "Invoice not found")
            return
        match = re.fullmatch(r"/quotation/(\d+)", parsed.path)
        if match:
            try:
                self.send_text(quotation_html(get_quotation(int(match.group(1)))), "text/html; charset=utf-8")
            except KeyError:
                self.send_error(HTTPStatus.NOT_FOUND, "Quotation not found")
            return
        if parsed.path == "/export.csv":
            content = customers_csv()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="shanex_customers.csv"')
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:
        if self.path == "/api/customers":
            try:
                self.send_json(create_customer(self.read_json()), HTTPStatus.CREATED)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        match = re.fullmatch(r"/api/customers/(\d+)/quotation", self.path)
        if match:
            try:
                self.send_json(create_quotation(int(match.group(1)), self.read_json()), HTTPStatus.CREATED)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except KeyError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            return
        match = re.fullmatch(r"/api/customers/(\d+)/pcs", self.path)
        if match:
            try:
                self.send_json(create_customer_pc(int(match.group(1)), self.read_json()), HTTPStatus.CREATED)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except KeyError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            return
        match = re.fullmatch(r"/api/customers/(\d+)/invoice", self.path)
        if match:
            try:
                self.send_json(create_invoice(int(match.group(1)), self.read_json()), HTTPStatus.CREATED)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except KeyError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            return
        match = re.fullmatch(r"/api/quotations/(\d+)/invoice", self.path)
        if match:
            try:
                self.send_json(create_invoice_from_quotation(int(match.group(1)), self.read_json()), HTTPStatus.CREATED)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except KeyError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_PUT(self) -> None:
        if self.path == "/api/company-settings":
            self.send_json(update_company_settings(self.read_json()))
            return
        match = re.fullmatch(r"/api/customers/(\d+)/payment", self.path)
        if match:
            try:
                self.send_json(update_payment(int(match.group(1)), self.read_json()))
            except ValueError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except KeyError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            return
        match = re.fullmatch(r"/api/customers/(\d+)", self.path)
        if not match:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        try:
            self.send_json(update_customer(int(match.group(1)), self.read_json()))
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except KeyError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        match = re.fullmatch(r"/api/customers/(\d+)/pcs/(\d+)", self.path)
        if match:
            try:
                delete_customer_pc(int(match.group(1)), int(match.group(2)))
                self.send_json({"ok": True})
            except KeyError as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
            return
        match = re.fullmatch(r"/api/customers/(\d+)", self.path)
        if not match:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        try:
            delete_customer(int(match.group(1)))
            self.send_json({"ok": True})
        except KeyError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def send_text(self, text: str, content_type: str) -> None:
        content = text.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {self.address_string()} {format % args}")


def main() -> None:
    setup_database()
    server = ThreadingHTTPServer((HOST, PORT), CustomerAppHandler)
    print(f"Shanex Customer Database running at http://{HOST}:{PORT}")
    print(f"Database file: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
