from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from pathlib import Path
from typing import List

import hashlib
import json
import shutil
import subprocess
import sys


APP_DIR = Path(__file__).resolve().parent

GENERATED_DIR = (
    APP_DIR /
    "generated_dubs"
)

GENERATED_DIR.mkdir(
    parents=True,
    exist_ok=True
)


app = FastAPI(
    title="VOX Dub Engine",
    version="2.0.1",
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
        directory=str(
            GENERATED_DIR
        )
    ),
    name="media",
)


def run_command(
    command,
    cwd=None,
):
    result = subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise RuntimeError(
            (
                result.stderr
                or
                result.stdout
                or
                "Command failed."
            )[-7000:]
        )

    return result


def media_url(job_id, filename):
    return f"/api-mix/media/{job_id}/{filename}"


def find_source_file(
    job_dir,
):
    matches = list(
        job_dir.glob(
            "source.*"
        )
    )

    if not matches:
        raise FileNotFoundError(
            "Original source video is missing."
        )

    return matches[0]


def prepare_stems(
    job_dir,
    source_path,
):
    background_path = (
        job_dir /
        "background.wav"
    )

    vocals_path = (
        job_dir /
        "vocals.wav"
    )

    if (
        background_path.exists()
        and
        vocals_path.exists()
    ):
        return (
            background_path,
            vocals_path,
        )

    input_wav = (
        job_dir /
        "scene_audio.wav"
    )

    run_command([
        "ffmpeg",
        "-y",
        "-i",
        str(source_path),
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-c:a",
        "pcm_s16le",
        str(input_wav),
    ])

    demucs_out = (
        job_dir /
        "demucs"
    )

    run_command([
        sys.executable,
        "-m",
        "demucs",
        "--two-stems=vocals",
        "-n",
        "htdemucs",
        "-d",
        "cpu",
        "--shifts",
        "1",
        "--out",
        str(demucs_out),
        str(input_wav),
    ])

    track_dir = (
        demucs_out /
        "htdemucs" /
        input_wav.stem
    )

    generated_vocals = (
        track_dir /
        "vocals.wav"
    )

    generated_background = (
        track_dir /
        "no_vocals.wav"
    )

    if (
        not generated_vocals.exists()
        or
        not generated_background.exists()
    ):
        raise RuntimeError(
            "Demucs did not create the expected stems."
        )

    shutil.copy2(
        generated_vocals,
        vocals_path,
    )

    shutil.copy2(
        generated_background,
        background_path,
    )

    return (
        background_path,
        vocals_path,
    )


@app.get("/")
def root():
    return {
        "status": "ok",
        "engine": "VOX Dub Engine v2",
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "ffmpeg": (
            shutil.which(
                "ffmpeg"
            )
            is not None
        ),
    }


@app.post("/prepare-scene")
async def prepare_scene(
    video: UploadFile = File(...),
):
    content = await video.read()

    digest = hashlib.sha256(
        content
    ).hexdigest()[:20]

    job_id = f"dub-{digest}"

    job_dir = (
        GENERATED_DIR /
        job_id
    )

    job_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    suffix = (
        Path(
            video.filename
            or "scene.mp4"
        ).suffix
        or ".mp4"
    )

    source_path = (
        job_dir /
        f"source{suffix}"
    )

    if (
        not source_path.exists()
        or
        source_path.stat().st_size
        != len(content)
    ):
        source_path.write_bytes(
            content
        )

    try:
        background_path, vocals_path = (
            prepare_stems(
                job_dir,
                source_path,
            )
        )

    except Exception as error:
        print(
            (
                "PREPARE SCENE ERROR: "
                f"{type(error).__name__}: "
                f"{error}"
            ),
            flush=True,
        )

        raise HTTPException(
            status_code=500,
            detail=str(error),
        )

    return {
        "status": "ready",
        "job_id": job_id,

        "background_url":
            media_url(
                job_id,
                background_path.name,
            ),

        "vocals_url":
            media_url(
                job_id,
                vocals_path.name,
            ),
    }


def vocal_gain_expression(
    entries,
    fade_seconds=0.075,
):
    """
    Continuous gain envelope for the original vocal stem.

    The frontend sends:
    - start/end: dialogue timing
    - replace_start/replace_end: slightly padded replacement window

    We use smooth fades around that padded window so the
    original actor does not pop in/out between takes.
    """

    expressions = []

    for entry in entries:
        start = float(
            entry.get(
                "replace_start",
                entry["start"],
            )
        )

        end = float(
            entry.get(
                "replace_end",
                entry["end"],
            )
        )

        fade = min(
            fade_seconds,
            max(
                0.025,
                (end - start) /
                4,
            ),
        )

        fade_in_start = max(
            0,
            start - fade,
        )

        fade_out_end = (
            end + fade
        )

        expression = (
            "if(lt(t,"
            f"{fade_in_start:.6f}),"
            "1,"
            "if(lt(t,"
            f"{start:.6f}),"
            f"({start:.6f}-t)/{fade:.6f},"
            "if(lt(t,"
            f"{end:.6f}),"
            "0,"
            "if(lt(t,"
            f"{fade_out_end:.6f}),"
            f"(t-{end:.6f})/{fade:.6f},"
            "1))))"
        )

        expressions.append(
            f"({expression})"
        )

    if not expressions:
        return "1"

    return "*".join(
        expressions
    )


@app.post("/render-final")
async def render_final(
    job_id: str = Form(...),

    manifest: str = Form(...),

    takes: List[UploadFile] =
        File(...),
):
    try:
        entries = json.loads(
            manifest
        )

    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid take manifest.",
        )

    job_dir = (
        GENERATED_DIR /
        job_id
    )

    if not job_dir.exists():
        raise HTTPException(
            status_code=404,
            detail="Prepared scene was not found.",
        )

    try:
        source_path = find_source_file(
            job_dir
        )

        background_path, vocals_path = (
            prepare_stems(
                job_dir,
                source_path,
            )
        )

    except Exception as error:
        print(
            (
                "RENDER FINAL PREP ERROR: "
                f"{type(error).__name__}: "
                f"{error}"
            ),
            flush=True,
        )

        raise HTTPException(
            status_code=500,
            detail=str(error),
        )

    if (
        len(entries) !=
        len(takes)
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Take manifest and files "
                "do not match."
            ),
        )

    takes_dir = (
        job_dir /
        "takes"
    )

    takes_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    saved_takes = []

    for index, upload in enumerate(
        takes
    ):
        suffix = (
            Path(
                upload.filename
                or
                f"take-{index}.webm"
            ).suffix
            or ".webm"
        )

        take_path = (
            takes_dir /
            f"take-{index}{suffix}"
        )

        take_path.write_bytes(
            await upload.read()
        )

        saved_takes.append(
            take_path
        )

    final_path = (
        job_dir /
        "final_dub.mp4"
    )

    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(source_path),
        "-i",
        str(background_path),
        "-i",
        str(vocals_path),
    ]

    for take_path in saved_takes:
        command.extend([
            "-i",
            str(take_path),
        ])

    vocal_gain = (
        vocal_gain_expression(
            entries
        )
    )

    filters = [
        (
            "[1:a]"
            "aresample=48000,"
            "aformat=sample_fmts=fltp:"
            "channel_layouts=stereo,"
            "volume=1"
            "[background]"
        ),
        (
            "[2:a]"
            "aresample=48000,"
            "aformat=sample_fmts=fltp:"
            "channel_layouts=stereo,"
            f"volume='{vocal_gain}':eval=frame"
            "[original_vocals]"
        ),
    ]

    take_labels = []

    for index, entry in enumerate(
        entries
    ):
        input_index = index + 3

        start = float(
            entry["start"]
        )

        end = float(
            entry["end"]
        )

        capture_start = float(
            entry.get(
                "capture_start",
                start,
            )
        )

        capture_end = float(
            entry.get(
                "capture_end",
                end,
            )
        )

        duration = max(
            0.08,
            capture_end -
            capture_start,
        )

        offset_ms = float(
            entry.get(
                "offset_ms",
                0,
            )
        )

        timeline_start = max(
            0,
            capture_start +
            offset_ms /
            1000,
        )

        delay_ms = max(
            0,
            int(
                round(
                    timeline_start *
                    1000
                )
            )
        )

        fade = min(
            0.045,
            duration /
            8,
        )

        fade_out_start = max(
            0,
            duration - fade,
        )

        label = f"take_{index}"

        filters.append(
            (
                f"[{input_index}:a]"
                "aresample=48000,"
                "aformat=sample_fmts=fltp:"
                "channel_layouts=stereo,"
                f"atrim=0:{duration:.6f},"
                "asetpts=PTS-STARTPTS,"
                f"afade=t=in:st=0:d={fade:.6f},"
                f"afade=t=out:"
                f"st={fade_out_start:.6f}:"
                f"d={fade:.6f},"
                f"adelay={delay_ms}|{delay_ms}"
                f"[{label}]"
            )
        )

        take_labels.append(
            f"[{label}]"
        )

    mix_inputs = (
        "[background]"
        "[original_vocals]"
        +
        "".join(
            take_labels
        )
    )

    input_count = (
        2 +
        len(
            take_labels
        )
    )

    filters.append(
        (
            f"{mix_inputs}"
            f"amix=inputs={input_count}:"
            "duration=longest:"
            "dropout_transition=0:"
            "normalize=0,"
            "alimiter=limit=0.96"
            "[final_audio]"
        )
    )

    filter_complex = ";".join(
        filters
    )

    command.extend([
        "-filter_complex",
        filter_complex,

        "-map",
        "0:v:0",

        "-map",
        "[final_audio]",

        "-c:v",
        "copy",

        "-c:a",
        "aac",

        "-b:a",
        "192k",

        "-movflags",
        "+faststart",

        "-shortest",

        str(final_path),
    ])

    try:
        run_command(
            command
        )

    except Exception as error:
        print(
            (
                "RENDER FINAL ERROR: "
                f"{type(error).__name__}: "
                f"{error}"
            ),
            flush=True,
        )

        raise HTTPException(
            status_code=500,
            detail=str(error),
        )

    return {
        "status": "ready",

        "final_url":
            media_url(
                job_id,
                final_path.name,
            ),
    }