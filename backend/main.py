from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import httpx
import json
import os
import struct
import subprocess
import tempfile
import wave


app = FastAPI(
    title="Voice Challenge AI Backend",
    version="1.3.1",
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

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail="ffprobe is not installed on the server.",
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not inspect video: {exc.stderr}",
        ) from exc

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
                try:
                    numerator, denominator = frame_rate.split("/")

                    if float(denominator) != 0:
                        fps = round(
                            float(numerator) / float(denominator),
                            2,
                        )
                except (TypeError, ValueError, ZeroDivisionError):
                    fps = None

        if stream.get("codec_type") == "audio":
            has_audio = True

    duration_value = metadata.get(
        "format",
        {},
    ).get("duration")

    if duration_value:
        try:
            duration = round(float(duration_value), 2)
        except (TypeError, ValueError):
            duration = None

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
# FLAC is much smaller than uncompressed WAV and is accepted
# directly by Groq.
# =========================================================

def extract_audio(video_path, audio_path):
    command = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "flac",
        audio_path,
    ]

    try:
        subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail="ffmpeg is not installed on the server.",
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not extract audio: {exc.stderr}",
        ) from exc


# =========================================================
# SMALL WAV FOR WAVEFORM
#
# Python's built-in wave module cannot read FLAC, so create a
# small temporary PCM WAV only for waveform generation.
# =========================================================

def extract_waveform_audio(video_path, waveform_path):
    command = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-acodec",
        "pcm_s16le",
        waveform_path,
    ]

    try:
        subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail="ffmpeg is not installed on the server.",
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not prepare waveform audio: {exc.stderr}",
        ) from exc


# =========================================================
# WAVEFORM
# =========================================================

def generate_waveform(audio_path, points=220):
    with wave.open(audio_path, "rb") as wav_file:
        sample_width = wav_file.getsampwidth()
        frame_count = wav_file.getnframes()

        if sample_width != 2:
            raise ValueError(
                "Waveform generator expects 16-bit PCM audio."
            )

        if frame_count <= 0:
            return []

        # Avoid loading/expanding the entire audio into a giant
        # Python tuple. Read small windows instead.
        frames_per_point = max(
            1,
            frame_count // points,
        )

        amplitudes = []

        for _ in range(points):
            raw_audio = wav_file.readframes(frames_per_point)

            if not raw_audio:
                break

            sample_count = len(raw_audio) // 2

            if sample_count <= 0:
                continue

            samples = struct.unpack(
                f"<{sample_count}h",
                raw_audio[: sample_count * 2],
            )

            peak = max(
                abs(sample)
                for sample in samples
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

    # Important:
    # Keep data as a dictionary. Passing a list of tuples to
    # httpx together with files caused:
    #
    # TypeError: expected a bytes-like object, tuple found
    #
    # We request word-level timestamps. VOX can build its own
    # subtitle/dialogue segments from these words.
    data = {
        "model": GROQ_WHISPER_MODEL,
        "response_format": "verbose_json",
        "temperature": "0",
        "timestamp_granularities[]": "word",
    }

    if forced_language:
        data["language"] = forced_language

    try:
        with open(audio_path, "rb") as audio_file:
            files = {
                "file": (
                    "audio.flac",
                    audio_file,
                    "audio/flac",
                )
            }

            with httpx.Client(
                timeout=httpx.Timeout(
                    180.0,
                    connect=30.0,
                )
            ) as client:
                response = client.post(
                    GROQ_TRANSCRIPTION_URL,
                    headers={
                        "Authorization": (
                            f"Bearer {GROQ_API_KEY}"
                        ),
                    },
                    data=data,
                    files=files,
                )

    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not reach Groq transcription "
                f"service: {exc}"
            ),
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

    try:
        result = response.json()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Groq returned an invalid JSON response.",
        ) from exc

    global_words = result.get("words") or []
    raw_segments = result.get("segments") or []

    transcript_segments = []

    # -----------------------------------------------------
    # Use provider segments when available
    # -----------------------------------------------------

    for segment in raw_segments:
        seg_start = _safe_float(
            segment.get("start")
        )

        seg_end = _safe_float(
            segment.get("end")
        )

        seg_text = (
            segment.get("text")
            or ""
        ).strip()

        words = []

        segment_words = (
            segment.get("words")
            or []
        )

        for word in segment_words:
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

        # If words are global instead of embedded in each
        # segment, attach the ones inside this time window.
        if not words and global_words:
            for word in global_words:
                word_start = _safe_float(
                    word.get("start")
                )

                word_end = _safe_float(
                    word.get("end")
                )

                if (
                    word_start >= seg_start - 0.05
                    and word_end <= seg_end + 0.05
                ):
                    clean_word = (
                        word.get("word")
                        or word.get("text")
                        or ""
                    ).strip()

                    if clean_word:
                        words.append({
                            "word": clean_word,
                            "start": round(
                                word_start,
                                2,
                            ),
                            "end": round(
                                word_end,
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

    # -----------------------------------------------------
    # Groq may return global words without segments.
    # Build one temporary transcript segment in that case.
    # build_subtitle_lines() will split it naturally.
    # -----------------------------------------------------

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

        text = (
            result.get("text")
            or ""
        ).strip()

        if text and words:
            transcript_segments.append({
                "start": words[0]["start"],
                "end": words[-1]["end"],
                "text": text,
                "words": words,
            })

    # -----------------------------------------------------
    # Last fallback: text only
    # -----------------------------------------------------

    if not transcript_segments:
        text = (
            result.get("text")
            or ""
        ).strip()

        if text:
            transcript_segments.append({
                "start": 0.0,
                "end": _safe_float(
                    result.get("duration")
                ),
                "text": text,
                "words": [],
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

    for segment in transcription.get(
        "segments",
        [],
    ):
        segment_words = segment.get(
            "words",
            [],
        )

        if segment_words:
            all_words.extend(segment_words)

        elif segment.get("text"):
            # If word timestamps aren't available, keep
            # provider segments as subtitle lines.
            return [
                {
                    "start": item["start"],
                    "end": item["end"],
                    "text": item["text"],
                }
                for item in transcription.get(
                    "segments",
                    [],
                )
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
            word["word"]
            for word in current
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

        punctuation_end = (
            word["word"].endswith(
                ending_marks
            )
        )

        duration = (
            current[-1]["end"]
            - current[0]["start"]
        )

        gap_after = (
            next_word["start"] - word["end"]
            if next_word
            else 0
        )

        enough_words_for_pause = (
            len(current) >= 2
        )

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
# MAIN ANALYSIS ENDPOINT
# =========================================================

@app.post("/analyze-video")
async def analyze_video(
    video: UploadFile = File(...),
    language: str = Form("auto"),
):
    original_filename = (
        video.filename
        or "video.mp4"
    )

    suffix = os.path.splitext(
        original_filename
    )[1]

    if not suffix:
        suffix = ".mp4"

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
        # Stream the uploaded video to disk instead of doing
        # await video.read(), which could duplicate a large
        # video in Render's limited RAM.
        with open(video_path, "wb") as output_file:
            while True:
                chunk = await video.read(
                    1024 * 1024
                )

                if not chunk:
                    break

                total_bytes += len(chunk)
                output_file.write(chunk)

        await video.close()

        if total_bytes == 0:
            raise HTTPException(
                status_code=400,
                detail="The uploaded video is empty.",
            )

        video_info = get_video_metadata(
            video_path
        )

        if not video_info["has_audio"]:
            return {
                "status": "analyzed",
                "filename": original_filename,
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
                "suggested_modes": [
                    "solo",
                ],
            }

        # FLAC for Groq
        extract_audio(
            video_path,
            audio_path,
        )

        # Low-rate temporary WAV only for waveform
        extract_waveform_audio(
            video_path,
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
            "filename": original_filename,
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

    except HTTPException:
        raise

    except Exception as exc:
        # Makes unexpected production failures visible in
        # Render logs and gives the frontend a useful error.
        print(
            f"VIDEO ANALYSIS ERROR: "
            f"{type(exc).__name__}: {exc}",
            flush=True,
        )

        raise HTTPException(
            status_code=500,
            detail=(
                f"Video analysis failed: "
                f"{type(exc).__name__}: {exc}"
            ),
        ) from exc

    finally:
        for path in (
            video_path,
            audio_path,
            waveform_path,
        ):
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                pass