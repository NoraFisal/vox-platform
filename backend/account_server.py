from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "vox_accounts.db"

app = FastAPI(title="VOX Accounts & Credits")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

PACKAGES = {
    "mini": {
        "name": "Mini",
        "credits": 3,
        "price_sar": 19,
    },
    "creator": {
        "name": "Creator",
        "credits": 10,
        "price_sar": 39,
    },
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db


def init_db():
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                accepted_terms_at TEXT NOT NULL,
                free_trial_used INTEGER NOT NULL DEFAULT 0,
                credits INTEGER NOT NULL DEFAULT 0,
                total_used INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                package_key TEXT NOT NULL,
                package_name TEXT NOT NULL,
                credits_added INTEGER NOT NULL,
                price_sar INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS creations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                scene_id TEXT NOT NULL,
                mode TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, scene_id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
            """
        )


@app.on_event("startup")
def startup():
    init_db()


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        180_000,
    )
    return (
        base64.b64encode(salt).decode()
        + "$"
        + base64.b64encode(digest).decode()
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_b64, digest_b64 = stored.split("$", 1)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
    except Exception:
        return False

    actual = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        180_000,
    )
    return hmac.compare_digest(actual, expected)


def make_token() -> str:
    return secrets.token_urlsafe(32)


def auth_user(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Please sign in first.")

    token = authorization[7:].strip()

    with connect() as db:
        row = db.execute(
            """
            SELECT users.*
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ?
            """,
            (token,),
        ).fetchone()

    if not row:
        raise HTTPException(401, "Your session has expired.")

    return row


def profile_for(user_id: int):
    with connect() as db:
        user = db.execute(
            "SELECT * FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

        purchases = db.execute(
            """
            SELECT id, package_name, credits_added,
                   price_sar, created_at
            FROM purchases
            WHERE user_id = ?
            ORDER BY id DESC
            """,
            (user_id,),
        ).fetchall()

        purchased = sum(
            int(row["credits_added"])
            for row in purchases
        )

    free_remaining = 0 if user["free_trial_used"] else 1

    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "free_trial_used": bool(user["free_trial_used"]),
        "credits": int(user["credits"]),
        "free_remaining": free_remaining,
        "remaining_creations": int(user["credits"]) + free_remaining,
        "total_purchased": purchased,
        "total_used": int(user["total_used"]),
        "purchases": [dict(row) for row in purchases],
    }


class AuthBody(BaseModel):
    name: str = ""
    email: EmailStr
    password: str
    accepted_terms: bool = False


class PurchaseBody(BaseModel):
    package: str


class ConsumeBody(BaseModel):
    scene_id: str
    mode: str = "solo"


@app.post("/signup")
def signup(body: AuthBody):
    name = body.name.strip()
    email = body.email.lower().strip()

    if not name:
        raise HTTPException(400, "Name is required.")

    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")

    if not body.accepted_terms:
        raise HTTPException(400, "You must accept the Terms & Conditions.")

    try:
        with connect() as db:
            cursor = db.execute(
                """
                INSERT INTO users (
                    name, email, password_hash,
                    accepted_terms_at, created_at
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    name,
                    email,
                    hash_password(body.password),
                    now_iso(),
                    now_iso(),
                ),
            )
            user_id = cursor.lastrowid
            token = make_token()
            db.execute(
                "INSERT INTO sessions VALUES (?, ?, ?)",
                (token, user_id, now_iso()),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "An account with this email already exists.")

    return {
        "token": token,
        "user": profile_for(user_id),
    }


@app.post("/login")
def login(body: AuthBody):
    email = body.email.lower().strip()

    with connect() as db:
        user = db.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,),
        ).fetchone()

        if not user or not verify_password(body.password, user["password_hash"]):
            raise HTTPException(401, "Incorrect email or password.")

        token = make_token()
        db.execute(
            "INSERT INTO sessions VALUES (?, ?, ?)",
            (token, user["id"], now_iso()),
        )

    return {
        "token": token,
        "user": profile_for(user["id"]),
    }


@app.get("/me")
def me(authorization: str | None = Header(default=None)):
    user = auth_user(authorization)
    return profile_for(user["id"])


@app.post("/purchase/simulate")
def simulate_purchase(
    body: PurchaseBody,
    authorization: str | None = Header(default=None),
):
    user = auth_user(authorization)

    package = PACKAGES.get(body.package.lower())

    if not package:
        raise HTTPException(400, "Unknown VOX package.")

    with connect() as db:
        db.execute(
            "UPDATE users SET credits = credits + ? WHERE id = ?",
            (package["credits"], user["id"]),
        )
        db.execute(
            """
            INSERT INTO purchases (
                user_id, package_key, package_name,
                credits_added, price_sar, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"],
                body.package.lower(),
                package["name"],
                package["credits"],
                package["price_sar"],
                now_iso(),
            ),
        )

    return profile_for(user["id"])


@app.post("/consume")
def consume(
    body: ConsumeBody,
    authorization: str | None = Header(default=None),
):
    user = auth_user(authorization)

    scene_id = body.scene_id.strip() or "scene"

    with connect() as db:
        existing = db.execute(
            """
            SELECT id
            FROM creations
            WHERE user_id = ? AND scene_id = ?
            """,
            (user["id"], scene_id),
        ).fetchone()

        if existing:
            return profile_for(user["id"])

        fresh = db.execute(
            "SELECT * FROM users WHERE id = ?",
            (user["id"],),
        ).fetchone()

        if not fresh["free_trial_used"]:
            source = "free_trial"
            db.execute(
                """
                UPDATE users
                SET free_trial_used = 1,
                    total_used = total_used + 1
                WHERE id = ?
                """,
                (user["id"],),
            )
        elif fresh["credits"] > 0:
            source = "credit"
            db.execute(
                """
                UPDATE users
                SET credits = credits - 1,
                    total_used = total_used + 1
                WHERE id = ?
                """,
                (user["id"],),
            )
        else:
            raise HTTPException(
                402,
                "No creation credits remaining.",
            )

        db.execute(
            """
            INSERT INTO creations (
                user_id, scene_id, mode, source, created_at
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                user["id"],
                scene_id,
                body.mode,
                source,
                now_iso(),
            ),
        )

    return profile_for(user["id"])
