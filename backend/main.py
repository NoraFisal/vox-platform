from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import gc
import json
import os
import struct
import subprocess
import tempfile
import wave

import httpx


app = FastAPI(
    title="Voice Challenge AI Backend",
    version="1.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# GROQ SPEECH-TO-TEXT
#
# Whisper now runs on Groq instead of inside Render.
# This keeps the same VOX flow while removing the local
# Whisper model from Render's 512 MB RAM.
# =========================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_TRANSCRIPTION_URL = (
    "https://api.groq.com/openai/v1/audio/transcriptions"
)
GROQ_WHISPER_MODEL = os.getenv(
    "GROQ_WHISPER_MODEL",
    "whisper-large-v3-turbo",
)


@app.get("/")
def root():
    return {
        "status": "ok",
        "message": "Voice Challenge backend is running",
        "speech_provider": "groq",
        "whisper_model": GROQ_WHISPER_MODEL,
    }


@app.get("/health")
def health():
    return {
        "backend": "online",
        "speech_provider": "groq",
        "groq_key_configured": bool(GROQ_API_KEY),
        "whisper_model": GROQ_WHISPER_MODEL,
    }


# =========================================================
# VIDEO METADATA
# =========================================================

def get_video_metadata(video_path):
    command = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        video_path,
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=True,
    )

    metadata = json.loads(result.stdout)

    duration = None
    width = None
    height = None
    fps = None
    has_audio = False

    for stream in metadata.get("streams", []):
        if stream.get("codec_type") == "video":
            width = stream.get("width")
            height = stream.get("height")

            frame_rate = stream.get("avg_frame_rate")

            if frame_rate and frame_rate != "0/0":
                numerator, denominator = frame_rate.split("/")

                if float(denominator) != 0:
                    fps = round(
                        float(numerator) / float(denominator),
                        2,
                    )

        if stream.get("codec_type") == "audio":
            has_audio = True

    duration_value = metadata.get(
        "format",
        {},
    ).get("duration")

    if duration_value:
        duration = round(float(duration_value), 2)

    return {
        "duration_seconds": duration,
        "width": width,
        "height": height,
        "fps": fps,
        "has_audio": has_audio,
    }


# =========================================================
# AUDIO EXTRACTION
#
# FLAC keeps speech quality while staying much smaller than
# PCM WAV. Groq supports FLAC directly.
# =========================================================

def extract_audio(video_path, audio_path):
    command = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "flac",
        audio_path,
    ]

    subprocess.run(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )


# =========================================================
# LOW-MEMORY WAVEFORM
#
# We create a tiny temporary WAV only for waveform sampling.
# It is read bucket-by-bucket, never loaded fully into RAM.
# =========================================================

def create_waveform_wav(audio_path, waveform_path):
    command = [
        "ffmpeg",
        "-y",
        "-i",
        audio_path,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        waveform_path,
    ]

    subprocess.run(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )


def generate_waveform(audio_path, points=220):
    amplitudes = []

    with wave.open(audio_path, "rb") as wav_file:
        sample_width = wav_file.getsampwidth()
        channels = wav_file.getnchannels()
        frame_count = wav_file.getnframes()

        if sample_width != 2:
            raise ValueError(
                "Waveform generator expects 16-bit PCM audio."
            )

        frames_per_point = max(
            1,
            frame_count // points,
        )

        for _ in range(points):
            raw_audio = wav_file.readframes(
                frames_per_point
            )

            if not raw_audio:
                break

            sample_count = (
                len(raw_audio) // sample_width
            )

            if sample_count <= 0:
                continue

            samples = struct.unpack(
                f"<{sample_count}h",
                raw_audio,
            )

            if channels > 1:
                samples = samples[::channels]

            peak = max(
                (abs(sample) for sample in samples),
                default=0,
            )

            amplitudes.append(
                round(peak / 32768, 4)
            )

    return amplitudes


# =========================================================
# GROQ TRANSCRIPTION
# =========================================================

def normalize_language(language):
    language = (language or "auto").strip().lower()

    if language in {"ar", "en"}:
        return language

    return None


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def transcribe_audio(audio_path, language="auto"):
    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY is not configured on the server.",
        )

    forced_language = normalize_language(language)

    data = {
        "model": GROQ_WHISPER_MODEL,
        "response_format": "verbose_json",
        "temperature": "0",
    }

    # Groq accepts both segment and word timestamps.
    # Sending both preserves the timing data VOX already uses.
    multipart_fields = [
        ("timestamp_granularities[]", "segment"),
        ("timestamp_granularities[]", "word"),
    ]

    if forced_language:
        data["language"] = forced_language

    with open(audio_path, "rb") as audio_file:
        files = {
            "file": (
                os.path.basename(audio_path),
                audio_file,
                "audio/flac",
            )
        }

        try:
            with httpx.Client(timeout=180.0) as client:
                response = client.post(
                    GROQ_TRANSCRIPTION_URL,
                    headers={
                        "Authorization": f"Bearer {GROQ_API_KEY}",
                    },
                    data=[
                        *list(data.items()),
                        *multipart_fields,
                    ],
                    files=files,
                )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Could not reach Groq transcription service: {exc}",
            ) from exc

    if response.status_code >= 400:
        try:
            error_body = response.json()
        except Exception:
            error_body = response.text

        raise HTTPException(
            status_code=502,
            detail={
                "message": "Groq transcription failed.",
                "provider_status": response.status_code,
                "provider_response": error_body,
            },
        )

    result = response.json()

    # Groq verbose_json can provide both segments and a global
    # word list. Prefer segment words when present; otherwise
    # attach global words to the matching segment window.
    global_words = result.get("words") or []
    raw_segments = result.get("segments") or []

    transcript_segments = []

    for segment in raw_segments:
        seg_start = _safe_float(segment.get("start"))
        seg_end = _safe_float(segment.get("end"))
        seg_text = (segment.get("text") or "").strip()

        raw_words = segment.get("words") or []

        if not raw_words and global_words:
            raw_words = [
                word
                for word in global_words
                if (
                    _safe_float(word.get("start")) >= seg_start - 0.05
                    and _safe_float(word.get("end")) <= seg_end + 0.05
                )
            ]

        words = []

        for word in raw_words:
            clean_word = (
                word.get("word")
                or word.get("text")
                or ""
            ).strip()

            if not clean_word:
                continue

            words.append({
                "word": clean_word,
                "start": round(
                    _safe_float(word.get("start")),
                    2,
                ),
                "end": round(
                    _safe_float(word.get("end")),
                    2,
                ),
            })

        if seg_text:
            transcript_segments.append({
                "start": round(seg_start, 2),
                "end": round(seg_end, 2),
                "text": seg_text,
                "words": words,
            })

    # Defensive fallback if Groq returns words but no segment list.
    if not transcript_segments and global_words:
        words = []

        for word in global_words:
            clean_word = (
                word.get("word")
                or word.get("text")
                or ""
            ).strip()

            if not clean_word:
                continue

            words.append({
                "word": clean_word,
                "start": round(
                    _safe_float(word.get("start")),
                    2,
                ),
                "end": round(
                    _safe_float(word.get("end")),
                    2,
                ),
            })

        text = (result.get("text") or "").strip()

        if text and words:
            transcript_segments.append({
                "start": words[0]["start"],
                "end": words[-1]["end"],
                "text": text,
                "words": words,
            })

    detected_language = (
        result.get("language")
        or forced_language
        or "unknown"
    )

    return {
        "language": detected_language,
        "language_probability": result.get(
            "language_probability"
        ),
        "forced_language": forced_language,
        "model": GROQ_WHISPER_MODEL,
        "provider": "groq",
        "segments": transcript_segments,
    }


# =========================================================
# SUBTITLE / DIALOGUE BLOCKS
# =========================================================

def build_subtitle_lines(transcription):
    all_words = []

    for segment in transcription.get("segments", []):
        segment_words = segment.get("words", [])

        if segment_words:
            all_words.extend(segment_words)
        elif segment.get("text"):
            return [
                {
                    "start": item["start"],
                    "end": item["end"],
                    "text": item["text"],
                }
                for item in transcription.get("segments", [])
                if item.get("text")
            ]

    if not all_words:
        return []

    ending_marks = (
        ".",
        "?",
        "!",
        "؟",
        "؛",
    )

    lines = []
    current = []

    max_words = 13
    max_duration = 5.0
    pause_split = 0.72

    def flush():
        nonlocal current

        if not current:
            return

        text = " ".join(
            word["word"] for word in current
        ).strip()

        if text:
            lines.append({
                "start": current[0]["start"],
                "end": current[-1]["end"],
                "text": text,
            })

        current = []

    for index, word in enumerate(all_words):
        current.append(word)

        next_word = (
            all_words[index + 1]
            if index + 1 < len(all_words)
            else None
        )

        punctuation_end = word["word"].endswith(
            ending_marks
        )

        duration = (
            current[-1]["end"] - current[0]["start"]
        )

        gap_after = (
            next_word["start"] - word["end"]
            if next_word
            else 0
        )

        enough_words_for_pause = len(current) >= 2

        should_flush = (
            punctuation_end
            or len(current) >= max_words
            or duration >= max_duration
            or (
                enough_words_for_pause
                and gap_after >= pause_split
            )
            or next_word is None
        )

        if should_flush:
            flush()

    return lines


# =========================================================
# LOW-MEMORY UPLOAD
# =========================================================

async def save_upload_in_chunks(
    upload: UploadFile,
    target_path: str,
    chunk_size: int = 1024 * 1024,
):
    total_bytes = 0

    with open(target_path, "wb") as target:
        while True:
            chunk = await upload.read(
                chunk_size
            )

            if not chunk:
                break

            target.write(chunk)
            total_bytes += len(chunk)

    return total_bytes


# =========================================================
# MAIN ANALYSIS ENDPOINT
# =========================================================

@app.post("/analyze-video")
async def analyze_video(
    video: UploadFile = File(...),
    language: str = Form("auto"),
):
    suffix = os.path.splitext(
        video.filename or "scene.mp4"
    )[1] or ".mp4"

    video_temp = tempfile.NamedTemporaryFile(
        delete=False,
        suffix=suffix,
    )

    audio_temp = tempfile.NamedTemporaryFile(
        delete=False,
        suffix=".flac",
    )

    waveform_temp = tempfile.NamedTemporaryFile(
        delete=False,
        suffix=".wav",
    )

    video_path = video_temp.name
    audio_path = audio_temp.name
    waveform_path = waveform_temp.name

    video_temp.close()
    audio_temp.close()
    waveform_temp.close()

    total_bytes = 0

    try:
        total_bytes = await save_upload_in_chunks(
            video,
            video_path,
        )

        video_info = get_video_metadata(
            video_path
        )

        if not video_info["has_audio"]:
            return {
                "status": "analyzed",
                "filename": video.filename,
                "content_type": video.content_type,
                "size_mb": round(
                    total_bytes / (1024 * 1024),
                    2,
                ),
                **video_info,
                "waveform": [],
                "transcription": None,
                "subtitle_lines": [],
                "dialogue": [],
                "suggested_modes": ["solo"],
            }

        extract_audio(
            video_path,
            audio_path,
        )

        create_waveform_wav(
            audio_path,
            waveform_path,
        )

        waveform = generate_waveform(
            waveform_path,
            points=220,
        )

        transcription = transcribe_audio(
            audio_path,
            language=language,
        )

        subtitle_lines = build_subtitle_lines(
            transcription
        )

        dialogue = [
            {
                "speaker": None,
                **line,
            }
            for line in subtitle_lines
        ]

        return {
            "status": "analyzed",
            "filename": video.filename,
            "content_type": video.content_type,
            "size_mb": round(
                total_bytes / (1024 * 1024),
                2,
            ),
            **video_info,
            "audio": {
                "sample_rate": 16000,
                "channels": 1,
                "format": "flac",
            },
            "waveform": waveform,
            "transcription": transcription,
            "subtitle_lines": subtitle_lines,
            "dialogue": dialogue,
            "suggested_modes": [
                "solo",
                "together",
                "invite",
            ],
        }

    finally:
        try:
            await video.close()
        except Exception:
            pass

        for temp_path in (
            video_path,
            audio_path,
            waveform_path,
        ):
            if os.path.exists(temp_path):
                os.remove(temp_path)

        gc.collect()
