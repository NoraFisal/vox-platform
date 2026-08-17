from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

import tempfile
import subprocess
import json
import os
import wave
import struct


app = FastAPI(
    title="Voice Challenge AI Backend",
    version="1.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# WHISPER
#
# "small" is a deliberate upgrade from "base":
# better multilingual/Arabic accuracy while still practical
# on a CPU laptop. You can override it later with:
#   $env:WHISPER_MODEL="medium"
# =========================================================

WHISPER_MODEL_NAME = os.getenv(
    "WHISPER_MODEL",
    "small"
)

whisper_model = WhisperModel(
    WHISPER_MODEL_NAME,
    device="cpu",
    compute_type="int8"
)


@app.get("/")
def root():
    return {
        "status": "ok",
        "message": "Voice Challenge backend is running",
        "whisper_model": WHISPER_MODEL_NAME,
    }


@app.get("/health")
def health():
    return {
        "backend": "online",
        "whisper": "ready",
        "whisper_model": WHISPER_MODEL_NAME,
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
        "-acodec",
        "pcm_s16le",
        audio_path,
    ]

    subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=True,
    )


# =========================================================
# WAVEFORM
# =========================================================

def generate_waveform(audio_path, points=220):
    with wave.open(audio_path, "rb") as wav_file:
        sample_width = wav_file.getsampwidth()
        frame_count = wav_file.getnframes()
        raw_audio = wav_file.readframes(frame_count)

    if sample_width != 2:
        raise ValueError(
            "Waveform generator expects 16-bit PCM audio."
        )

    sample_count = len(raw_audio) // 2

    samples = struct.unpack(
        f"<{sample_count}h",
        raw_audio,
    )

    samples_per_point = max(
        1,
        len(samples) // points,
    )

    amplitudes = []

    for index in range(
        0,
        len(samples),
        samples_per_point,
    ):
        chunk = samples[
            index:index + samples_per_point
        ]

        if not chunk:
            continue

        peak = max(abs(sample) for sample in chunk)

        amplitudes.append(
            round(peak / 32768, 4)
        )

    return amplitudes[:points]


# =========================================================
# TRANSCRIPTION
# =========================================================

def normalize_language(language):
    language = (language or "auto").strip().lower()

    if language in {"ar", "en"}:
        return language

    return None


def transcribe_audio(audio_path, language="auto"):
    forced_language = normalize_language(language)

    segments, info = whisper_model.transcribe(
        audio_path,
        language=forced_language,
        task="transcribe",
        beam_size=5,
        temperature=0,
        vad_filter=True,
        vad_parameters={
            "min_silence_duration_ms": 300,
        },
        word_timestamps=True,
        condition_on_previous_text=False,
    )

    transcript_segments = []

    for segment in segments:
        words = []

        if segment.words:
            for word in segment.words:
                clean_word = word.word.strip()

                if not clean_word:
                    continue

                words.append({
                    "word": clean_word,
                    "start": round(word.start, 2),
                    "end": round(word.end, 2),
                })

        text = segment.text.strip()

        if text:
            transcript_segments.append({
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": text,
                "words": words,
            })

    return {
        "language": info.language,
        "language_probability": round(
            info.language_probability,
            3,
        ),
        "forced_language": forced_language,
        "model": WHISPER_MODEL_NAME,
        "segments": transcript_segments,
    }


# =========================================================
# SUBTITLE / DIALOGUE BLOCKS
#
# Whisper punctuation is not always reliable for dialectal
# Arabic, so blocks are split using a combination of:
# - punctuation
# - pauses between words
# - maximum line duration
# - maximum word count
# =========================================================

def build_subtitle_lines(transcription):
    all_words = []

    for segment in transcription.get("segments", []):
        segment_words = segment.get("words", [])

        if segment_words:
            all_words.extend(segment_words)
        elif segment.get("text"):
            # Fallback when word timestamps are unavailable.
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
# MAIN ANALYSIS ENDPOINT
# =========================================================

@app.post("/analyze-video")
async def analyze_video(
    video: UploadFile = File(...),
    language: str = Form("auto"),
):
    suffix = os.path.splitext(video.filename)[1]

    video_temp = tempfile.NamedTemporaryFile(
        delete=False,
        suffix=suffix,
    )

    audio_temp = tempfile.NamedTemporaryFile(
        delete=False,
        suffix=".wav",
    )

    video_path = video_temp.name
    audio_path = audio_temp.name

    video_temp.close()
    audio_temp.close()

    content = await video.read()

    with open(video_path, "wb") as file:
        file.write(content)

    try:
        video_info = get_video_metadata(video_path)

        if not video_info["has_audio"]:
            return {
                "status": "analyzed",
                "filename": video.filename,
                **video_info,
                "waveform": [],
                "transcription": None,
                "subtitle_lines": [],
                "dialogue": [],
                "suggested_modes": ["solo"],
            }

        extract_audio(video_path, audio_path)

        waveform = generate_waveform(
            audio_path,
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

        file_size_mb = round(
            len(content) / (1024 * 1024),
            2,
        )

        return {
            "status": "analyzed",
            "filename": video.filename,
            "content_type": video.content_type,
            "size_mb": file_size_mb,
            **video_info,
            "audio": {
                "sample_rate": 16000,
                "channels": 1,
                "format": "wav",
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
        if os.path.exists(video_path):
            os.remove(video_path)

        if os.path.exists(audio_path):
            os.remove(audio_path)
