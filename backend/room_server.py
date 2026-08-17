from __future__ import annotations

import json
import re
import secrets
import sqlite3
import time
from pathlib import Path

import httpx

from fastapi import (
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


BASE_DIR = Path(__file__).resolve().parent

DB_PATH = (
    BASE_DIR /
    "vox_rooms.sqlite3"
)

MEDIA_DIR = (
    BASE_DIR /
    "room_media"
)

MEDIA_DIR.mkdir(
    parents=True,
    exist_ok=True,
)

MIX_SERVICE_URL = (
    "http://127.0.0.1:8002"
)


app = FastAPI(
    title="VOX Invite Rooms",
    version="3.0.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.mount(
    "/media",
    StaticFiles(
        directory=MEDIA_DIR
    ),
    name="room-media",
)


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(
        DB_PATH,
        timeout=30,
    )

    connection.row_factory = (
        sqlite3.Row
    )

    return connection


def ensure_column(
    connection: sqlite3.Connection,
    table: str,
    name: str,
    ddl: str,
) -> None:
    columns = {
        row["name"]
        for row in connection.execute(
            f"PRAGMA table_info({table})"
        ).fetchall()
    }

    if name not in columns:
        connection.execute(
            f"ALTER TABLE {table} "
            f"ADD COLUMN {name} {ddl}"
        )


def init_db() -> None:
    connection = db()

    try:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS rooms (
                room_code TEXT PRIMARY KEY,
                scene_id TEXT NOT NULL,
                scene_title TEXT NOT NULL DEFAULT '',
                scene_title_ar TEXT NOT NULL DEFAULT '',
                mode TEXT NOT NULL DEFAULT 'invite',

                host_token TEXT NOT NULL,
                host_name TEXT NOT NULL DEFAULT 'Host',

                guest_token TEXT,
                guest_name TEXT,

                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )

        ensure_column(
            connection,
            "rooms",
            "scene_video_path",
            "TEXT",
        )

        ensure_column(
            connection,
            "rooms",
            "analysis_json",
            "TEXT",
        )

        ensure_column(
            connection,
            "rooms",
            "setup_json",
            "TEXT",
        )

        ensure_column(
            connection,
            "rooms",
            "host_finished",
            "INTEGER NOT NULL DEFAULT 0",
        )

        ensure_column(
            connection,
            "rooms",
            "guest_finished",
            "INTEGER NOT NULL DEFAULT 0",
        )

        ensure_column(
            connection,
            "rooms",
            "render_status",
            "TEXT NOT NULL DEFAULT 'idle'",
        )

        ensure_column(
            connection,
            "rooms",
            "render_error",
            "TEXT",
        )

        ensure_column(
            connection,
            "rooms",
            "final_url",
            "TEXT",
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS room_takes (
                room_code TEXT NOT NULL,
                line_id TEXT NOT NULL,
                participant_role TEXT NOT NULL,

                file_path TEXT NOT NULL,
                mime_type TEXT NOT NULL,

                line_start REAL NOT NULL,
                line_end REAL NOT NULL,

                capture_start REAL NOT NULL,
                capture_end REAL NOT NULL,

                offset_ms REAL NOT NULL DEFAULT 0,

                updated_at INTEGER NOT NULL,

                PRIMARY KEY (
                    room_code,
                    line_id,
                    participant_role
                )
            )
            """
        )

        connection.commit()
    finally:
        connection.close()


init_db()


class CreateRoomBody(BaseModel):
    scene_id: str
    scene_title: str = ""
    scene_title_ar: str = ""
    mode: str = "invite"


class JoinRoomBody(BaseModel):
    display_name: str


class SaveSetupBody(BaseModel):
    setup: dict


def make_room_code(
    length: int = 6,
) -> str:
    alphabet = (
        "ABCDEFGHJKLMNPQRSTUVWXYZ"
        "23456789"
    )

    while True:
        code = "".join(
            secrets.choice(alphabet)
            for _ in range(length)
        )

        connection = db()

        try:
            exists = connection.execute(
                """
                SELECT 1
                FROM rooms
                WHERE room_code = ?
                """,
                (code,),
            ).fetchone()
        finally:
            connection.close()

        if not exists:
            return code


def load_json(value):
    if not value:
        return None

    try:
        return json.loads(value)
    except Exception:
        return None


def clean_filename_part(
    value: str,
) -> str:
    cleaned = re.sub(
        r"[^A-Za-z0-9_.-]+",
        "-",
        str(value),
    )

    return cleaned[:120] or "take"


def get_room_row(
    code: str,
) -> sqlite3.Row:
    connection = db()

    try:
        row = connection.execute(
            """
            SELECT *
            FROM rooms
            WHERE room_code = ?
            """,
            (code,),
        ).fetchone()
    finally:
        connection.close()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Room not found.",
        )

    return row


def bearer_token(
    authorization: str | None,
) -> str:
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Participant token required.",
        )

    prefix = "Bearer "

    if not authorization.startswith(
        prefix
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization header.",
        )

    return authorization[
        len(prefix):
    ].strip()


def participant_from_token(
    row: sqlite3.Row,
    token: str,
) -> str:
    if token == row["host_token"]:
        return "host"

    if (
        row["guest_token"] and
        token == row["guest_token"]
    ):
        return "guest"

    raise HTTPException(
        status_code=403,
        detail="This token does not belong to this room.",
    )


def role_key_for_participant(
    participant_role: str,
) -> str:
    return (
        "person-1"
        if participant_role == "host"
        else "person-2"
    )


def required_lines(
    setup: dict | None,
    participant_role: str,
) -> list[dict]:
    if not setup:
        return []

    role_key = (
        role_key_for_participant(
            participant_role
        )
    )

    return [
        line
        for line in (
            setup.get("dialogue") or []
        )
        if line.get("role") == role_key
    ]


def take_rows_for_room(
    code: str,
) -> list[sqlite3.Row]:
    connection = db()

    try:
        rows = connection.execute(
            """
            SELECT *
            FROM room_takes
            WHERE room_code = ?
            ORDER BY updated_at ASC
            """,
            (code,),
        ).fetchall()
    finally:
        connection.close()

    return rows


def progress_for_room(
    row: sqlite3.Row,
) -> dict:
    setup = load_json(
        row["setup_json"]
    )

    host_required = required_lines(
        setup,
        "host",
    )

    guest_required = required_lines(
        setup,
        "guest",
    )

    takes = take_rows_for_room(
        row["room_code"]
    )

    host_ids = {
        take["line_id"]
        for take in takes
        if (
            take["participant_role"]
            == "host"
        )
    }

    guest_ids = {
        take["line_id"]
        for take in takes
        if (
            take["participant_role"]
            == "guest"
        )
    }

    host_required_ids = {
        str(line.get("id"))
        for line in host_required
    }

    guest_required_ids = {
        str(line.get("id"))
        for line in guest_required
    }

    host_done = len(
        host_required_ids &
        host_ids
    )

    guest_done = len(
        guest_required_ids &
        guest_ids
    )

    return {
        "host": {
            "done": host_done,
            "total": len(
                host_required_ids
            ),
            "finished": bool(
                row["host_finished"]
            ),
            "ready": (
                host_done ==
                len(host_required_ids)
            ),
        },
        "guest": {
            "done": guest_done,
            "total": len(
                guest_required_ids
            ),
            "finished": bool(
                row["guest_finished"]
            ),
            "ready": (
                guest_done ==
                len(guest_required_ids)
            ),
        },
    }


def room_media_url(
    row: sqlite3.Row,
) -> str | None:
    if not row["scene_video_path"]:
        return None

    return (
        f"/rooms-api/media/"
        f"{row['room_code']}/scene.mp4"
    )


def row_to_public(
    row: sqlite3.Row,
) -> dict:
    return {
        "room_code":
            row["room_code"],

        "scene_id":
            row["scene_id"],

        "scene_title":
            row["scene_title"],

        "scene_title_ar":
            row["scene_title_ar"],

        "mode":
            row["mode"],

        "host_name":
            row["host_name"],

        "guest_name":
            row["guest_name"],

        "created_at":
            row["created_at"],

        "updated_at":
            row["updated_at"],

        "full":
            bool(
                row["guest_token"]
            ),

        "scene_video_url":
            room_media_url(row),

        "analysis":
            load_json(
                row["analysis_json"]
            ),

        "setup":
            load_json(
                row["setup_json"]
            ),

        "setup_ready":
            bool(
                row["setup_json"]
            ),

        "progress":
            progress_for_room(row),

        "render_status":
            row["render_status"],

        "render_error":
            row["render_error"],

        "final_url":
            row["final_url"],
    }


def normalize_mix_url(
    url: str | None,
) -> str | None:
    if not url:
        return url

    marker = "/media/"

    if marker in url:
        suffix = url.split(
            marker,
            1,
        )[1]

        return (
            f"/api-mix/media/{suffix}"
        )

    return url


def reset_room_recording_state(
    connection: sqlite3.Connection,
    code: str,
) -> None:
    old_rows = connection.execute(
        """
        SELECT file_path
        FROM room_takes
        WHERE room_code = ?
        """,
        (code,),
    ).fetchall()

    connection.execute(
        """
        DELETE FROM room_takes
        WHERE room_code = ?
        """,
        (code,),
    )

    connection.execute(
        """
        UPDATE rooms
        SET host_finished = 0,
            guest_finished = 0,
            render_status = 'idle',
            render_error = NULL,
            final_url = NULL
        WHERE room_code = ?
        """,
        (code,),
    )

    for old in old_rows:
        try:
            Path(
                old["file_path"]
            ).unlink(
                missing_ok=True
            )
        except Exception:
            pass


def all_required_takes(
    room_row: sqlite3.Row,
) -> tuple[
    list[dict],
    list[sqlite3.Row],
]:
    setup = load_json(
        room_row["setup_json"]
    )

    if not setup:
        raise HTTPException(
            status_code=409,
            detail="Role setup has not been saved yet.",
        )

    dialogue = (
        setup.get("dialogue") or []
    )

    takes = take_rows_for_room(
        room_row["room_code"]
    )

    take_map = {
        (
            take["participant_role"],
            take["line_id"],
        ):
            take
        for take in takes
    }

    ordered_lines = []
    ordered_takes = []

    for line in dialogue:
        role = line.get("role")

        if role == "original":
            continue

        if role == "person-1":
            participant_role = "host"
        elif role == "person-2":
            participant_role = "guest"
        else:
            # Invite mode only uses
            # person-1/person-2/original.
            continue

        line_id = str(
            line.get("id")
        )

        take = take_map.get(
            (
                participant_role,
                line_id,
            )
        )

        if not take:
            raise HTTPException(
                status_code=409,
                detail=(
                    "A required take is still missing: "
                    f"{line_id}"
                ),
            )

        ordered_lines.append(line)
        ordered_takes.append(take)

    return (
        ordered_lines,
        ordered_takes,
    )


async def render_room_final(
    code: str,
) -> dict:
    room_row = get_room_row(code)

    setup = load_json(
        room_row["setup_json"]
    )

    if not setup:
        raise HTTPException(
            status_code=409,
            detail="Room setup is missing.",
        )

    mix = (
        setup.get("mix") or {}
    )

    job_id = mix.get(
        "job_id"
    )

    if not job_id:
        raise HTTPException(
            status_code=409,
            detail="Prepared audio job is missing.",
        )

    lines, takes = all_required_takes(
        room_row
    )

    manifest = []

    for line, take in zip(
        lines,
        takes,
    ):
        manifest.append({
            "line_id":
                str(
                    line.get("id")
                ),

            "start":
                float(
                    line.get(
                        "start",
                        take["line_start"],
                    )
                ),

            "end":
                float(
                    line.get(
                        "end",
                        take["line_end"],
                    )
                ),

            "capture_start":
                float(
                    take["capture_start"]
                ),

            "capture_end":
                float(
                    take["capture_end"]
                ),

            "replace_start":
                max(
                    0,
                    float(
                        line.get(
                            "start",
                            take["line_start"],
                        )
                    ) -
                    0.10,
                ),

            "replace_end":
                float(
                    line.get(
                        "end",
                        take["line_end"],
                    )
                ) +
                0.16,

            "offset_ms":
                float(
                    take["offset_ms"]
                ),
        })

    handles = []

    files = []

    try:
        for index, take in enumerate(
            takes
        ):
            path = Path(
                take["file_path"]
            )

            handle = path.open(
                "rb"
            )

            handles.append(
                handle
            )

            files.append(
                (
                    "takes",
                    (
                        f"take-{index}"
                        f"{path.suffix}",
                        handle,
                        take["mime_type"]
                        or "audio/webm",
                    ),
                )
            )

        connection = db()

        try:
            connection.execute(
                """
                UPDATE rooms
                SET render_status = 'rendering',
                    render_error = NULL,
                    updated_at = ?
                WHERE room_code = ?
                """,
                (
                    int(time.time()),
                    code,
                ),
            )

            connection.commit()
        finally:
            connection.close()

        async with httpx.AsyncClient(
            timeout=None
        ) as client:
            response = await client.post(
                (
                    f"{MIX_SERVICE_URL}"
                    "/render-final"
                ),
                data={
                    "job_id":
                        job_id,

                    "manifest":
                        json.dumps(
                            manifest
                        ),
                },
                files=files,
            )

        if response.status_code >= 400:
            raise RuntimeError(
                response.text
                or
                "Final render failed."
            )

        data = response.json()

        final_url = normalize_mix_url(
            data.get(
                "final_url"
            )
        )

        connection = db()

        try:
            connection.execute(
                """
                UPDATE rooms
                SET render_status = 'ready',
                    render_error = NULL,
                    final_url = ?,
                    updated_at = ?
                WHERE room_code = ?
                """,
                (
                    final_url,
                    int(time.time()),
                    code,
                ),
            )

            connection.commit()

            updated = connection.execute(
                """
                SELECT *
                FROM rooms
                WHERE room_code = ?
                """,
                (code,),
            ).fetchone()
        finally:
            connection.close()

        return row_to_public(
            updated
        )

    except Exception as error:
        connection = db()

        try:
            connection.execute(
                """
                UPDATE rooms
                SET render_status = 'error',
                    render_error = ?,
                    updated_at = ?
                WHERE room_code = ?
                """,
                (
                    str(error)[-2000:],
                    int(time.time()),
                    code,
                ),
            )

            connection.commit()
        finally:
            connection.close()

        raise HTTPException(
            status_code=500,
            detail=str(error),
        )

    finally:
        for handle in handles:
            try:
                handle.close()
            except Exception:
                pass


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service":
            "vox-invite-rooms-v3",
    }


@app.post("/rooms")
def create_room(
    body: CreateRoomBody,
) -> dict:
    room_code = make_room_code()
    host_token = secrets.token_urlsafe(
        32
    )

    now = int(
        time.time()
    )

    connection = db()

    try:
        connection.execute(
            """
            INSERT INTO rooms (
                room_code,
                scene_id,
                scene_title,
                scene_title_ar,
                mode,
                host_token,
                host_name,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                room_code,
                body.scene_id,
                body.scene_title,
                body.scene_title_ar,
                body.mode,
                host_token,
                "Host",
                now,
                now,
            ),
        )

        connection.commit()

        row = connection.execute(
            """
            SELECT *
            FROM rooms
            WHERE room_code = ?
            """,
            (room_code,),
        ).fetchone()
    finally:
        connection.close()

    return {
        **row_to_public(row),

        "host_token":
            host_token,

        "participant_token":
            host_token,

        "participant_role":
            "host",
    }


@app.post(
    "/rooms/{room_code}/scene"
)
async def upload_room_scene(
    room_code: str,
    token: str = Form(...),
    analysis: str = Form("{}"),
    video: UploadFile = File(...),
) -> dict:
    code = (
        room_code
        .strip()
        .upper()
    )

    row = get_room_row(
        code
    )

    if token != row["host_token"]:
        raise HTTPException(
            status_code=403,
            detail=(
                "Only the host can prepare "
                "the shared scene."
            ),
        )

    room_dir = (
        MEDIA_DIR /
        code
    )

    room_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    target = (
        room_dir /
        "scene.mp4"
    )

    target.write_bytes(
        await video.read()
    )

    try:
        parsed_analysis = json.loads(
            analysis or "{}"
        )
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid analysis payload.",
        )

    now = int(
        time.time()
    )

    connection = db()

    try:
        connection.execute(
            """
            UPDATE rooms
            SET scene_video_path = ?,
                analysis_json = ?,
                updated_at = ?
            WHERE room_code = ?
            """,
            (
                str(target),
                json.dumps(
                    parsed_analysis,
                    ensure_ascii=False,
                ),
                now,
                code,
            ),
        )

        connection.commit()

        updated = connection.execute(
            """
            SELECT *
            FROM rooms
            WHERE room_code = ?
            """,
            (code,),
        ).fetchone()
    finally:
        connection.close()

    return row_to_public(
        updated
    )


@app.get("/rooms/{room_code}")
def get_room(
    room_code: str,
) -> dict:
    code = (
        room_code
        .strip()
        .upper()
    )

    return row_to_public(
        get_room_row(code)
    )


@app.post(
    "/rooms/{room_code}/join"
)
def join_room(
    room_code: str,
    body: JoinRoomBody,
) -> dict:
    code = (
        room_code
        .strip()
        .upper()
    )

    name = (
        body.display_name
        .strip()
    )

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Display name is required.",
        )

    connection = db()

    try:
        row = connection.execute(
            """
            SELECT *
            FROM rooms
            WHERE room_code = ?
            """,
            (code,),
        ).fetchone()

        if not row:
            raise HTTPException(
                status_code=404,
                detail="Room not found.",
            )

        if row["guest_token"]:
            raise HTTPException(
                status_code=409,
                detail=(
                    "This room already "
                    "has a guest."
                ),
            )

        guest_token = (
            secrets.token_urlsafe(
                32
            )
        )

        now = int(
            time.time()
        )

        connection.execute(
            """
            UPDATE rooms
            SET guest_token = ?,
                guest_name = ?,
                updated_at = ?
            WHERE room_code = ?
            """,
            (
                guest_token,
                name[:40],
                now,
                code,
            ),
        )

        connection.commit()

        updated = connection.execute(
            """
            SELECT *
            FROM rooms
            WHERE room_code = ?
            """,
            (code,),
        ).fetchone()
    finally:
        connection.close()

    return {
        **row_to_public(updated),

        "participant_token":
            guest_token,

        "participant_role":
            "guest",
    }


@app.put(
    "/rooms/{room_code}/setup"
)
def save_room_setup(
    room_code: str,
    body: SaveSetupBody,
    authorization: str | None = Header(
        default=None
    ),
) -> dict:
    code = (
        room_code
        .strip()
        .upper()
    )

    row = get_room_row(
        code
    )

    token = bearer_token(
        authorization
    )

    if token != row["host_token"]:
        raise HTTPException(
            status_code=403,
            detail=(
                "Only the host can save "
                "role assignments."
            ),
        )

    setup = body.setup

    host_total = len(
        required_lines(
            setup,
            "host",
        )
    )

    guest_total = len(
        required_lines(
            setup,
            "guest",
        )
    )

    now = int(
        time.time()
    )

    connection = db()

    try:
        reset_room_recording_state(
            connection,
            code,
        )

        connection.execute(
            """
            UPDATE rooms
            SET setup_json = ?,
                host_finished = ?,
                guest_finished = ?,
                updated_at = ?
            WHERE room_code = ?
            """,
            (
                json.dumps(
                    setup,
                    ensure_ascii=False,
                ),
                1 if host_total == 0 else 0,
                1 if guest_total == 0 else 0,
                now,
                code,
            ),
        )

        connection.commit()

        updated = connection.execute(
            """
            SELECT *
            FROM rooms
            WHERE room_code = ?
            """,
            (code,),
        ).fetchone()
    finally:
        connection.close()

    return row_to_public(
        updated
    )


@app.post(
    "/rooms/{room_code}/takes/{line_id}"
)
async def upload_take(
    room_code: str,
    line_id: str,

    token: str = Form(...),

    line_start: float = Form(...),
    line_end: float = Form(...),

    capture_start: float = Form(...),
    capture_end: float = Form(...),

    offset_ms: float = Form(0),

    take: UploadFile = File(...),
) -> dict:
    code = (
        room_code
        .strip()
        .upper()
    )

    row = get_room_row(
        code
    )

    participant_role = (
        participant_from_token(
            row,
            token,
        )
    )

    setup = load_json(
        row["setup_json"]
    )

    if not setup:
        raise HTTPException(
            status_code=409,
            detail=(
                "The host has not started "
                "the shared recording yet."
            ),
        )

    role_key = (
        role_key_for_participant(
            participant_role
        )
    )

    matching_line = next(
        (
            line
            for line in (
                setup.get("dialogue") or []
            )
            if (
                str(
                    line.get("id")
                ) ==
                str(line_id)
                and
                line.get("role")
                ==
                role_key
            )
        ),
        None,
    )

    if not matching_line:
        raise HTTPException(
            status_code=403,
            detail=(
                "This line is not assigned "
                "to this participant."
            ),
        )

    takes_dir = (
        MEDIA_DIR /
        code /
        "takes"
    )

    takes_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    suffix = (
        Path(
            take.filename
            or "take.webm"
        ).suffix
        or ".webm"
    )

    target = (
        takes_dir /
        (
            f"{participant_role}-"
            f"{clean_filename_part(line_id)}"
            f"{suffix}"
        )
    )

    content = await take.read()

    target.write_bytes(
        content
    )

    now = int(
        time.time()
    )

    connection = db()

    try:
        connection.execute(
            """
            INSERT INTO room_takes (
                room_code,
                line_id,
                participant_role,
                file_path,
                mime_type,
                line_start,
                line_end,
                capture_start,
                capture_end,
                offset_ms,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

            ON CONFLICT (
                room_code,
                line_id,
                participant_role
            )
            DO UPDATE SET
                file_path =
                    excluded.file_path,
                mime_type =
                    excluded.mime_type,
                line_start =
                    excluded.line_start,
                line_end =
                    excluded.line_end,
                capture_start =
                    excluded.capture_start,
                capture_end =
                    excluded.capture_end,
                offset_ms =
                    excluded.offset_ms,
                updated_at =
                    excluded.updated_at
            """,
            (
                code,
                str(line_id),
                participant_role,
                str(target),
                take.content_type
                or "audio/webm",
                float(line_start),
                float(line_end),
                float(capture_start),
                float(capture_end),
                float(offset_ms),
                now,
            ),
        )

        # Re-recording after "finish" makes the
        # participant unfinished again until they
        # explicitly finish the updated version.
        if participant_role == "host":
            connection.execute(
                """
                UPDATE rooms
                SET host_finished = 0,
                    render_status = 'idle',
                    render_error = NULL,
                    final_url = NULL,
                    updated_at = ?
                WHERE room_code = ?
                """,
                (
                    now,
                    code,
                ),
            )
        else:
            connection.execute(
                """
                UPDATE rooms
                SET guest_finished = 0,
                    render_status = 'idle',
                    render_error = NULL,
                    final_url = NULL,
                    updated_at = ?
                WHERE room_code = ?
                """,
                (
                    now,
                    code,
                ),
            )

        connection.commit()

        updated = connection.execute(
            """
            SELECT *
            FROM rooms
            WHERE room_code = ?
            """,
            (code,),
        ).fetchone()
    finally:
        connection.close()

    return row_to_public(
        updated
    )


@app.post(
    "/rooms/{room_code}/finish"
)
async def finish_participant(
    room_code: str,
    authorization: str | None = Header(
        default=None
    ),
) -> dict:
    code = (
        room_code
        .strip()
        .upper()
    )

    row = get_room_row(
        code
    )

    token = bearer_token(
        authorization
    )

    participant_role = (
        participant_from_token(
            row,
            token,
        )
    )

    progress = progress_for_room(
        row
    )

    participant_progress = (
        progress[
            participant_role
        ]
    )

    if not participant_progress[
        "ready"
    ]:
        raise HTTPException(
            status_code=409,
            detail=(
                "You still have takes "
                "left to record."
            ),
        )

    now = int(
        time.time()
    )

    connection = db()

    try:
        field = (
            "host_finished"
            if participant_role == "host"
            else "guest_finished"
        )

        connection.execute(
            f"""
            UPDATE rooms
            SET {field} = 1,
                updated_at = ?
            WHERE room_code = ?
            """,
            (
                now,
                code,
            ),
        )

        connection.commit()

        updated = connection.execute(
            """
            SELECT *
            FROM rooms
            WHERE room_code = ?
            """,
            (code,),
        ).fetchone()
    finally:
        connection.close()

    updated_progress = (
        progress_for_room(
            updated
        )
    )

    both_finished = (
        updated_progress[
            "host"
        ]["finished"]
        and
        updated_progress[
            "guest"
        ]["finished"]
    )

    all_ready = (
        updated_progress[
            "host"
        ]["ready"]
        and
        updated_progress[
            "guest"
        ]["ready"]
    )

    if (
        both_finished
        and
        all_ready
        and
        updated["render_status"]
        not in (
            "rendering",
            "ready",
        )
    ):
        return await render_room_final(
            code
        )

    return row_to_public(
        updated
    )


@app.post(
    "/rooms/{room_code}/render-if-ready"
)
async def render_if_ready(
    room_code: str,
) -> dict:
    code = (
        room_code
        .strip()
        .upper()
    )

    row = get_room_row(
        code
    )

    progress = progress_for_room(
        row
    )

    if (
        not progress["host"]["finished"]
        or
        not progress["guest"]["finished"]
        or
        not progress["host"]["ready"]
        or
        not progress["guest"]["ready"]
    ):
        return row_to_public(
            row
        )

    if row["render_status"] == "ready":
        return row_to_public(
            row
        )

    if row["render_status"] == "rendering":
        return row_to_public(
            row
        )

    return await render_room_final(
        code
    )
