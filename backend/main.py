from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

import gc
import json
import os
import struct
import subprocess
import tempfile
import wave


app = FastAPI(
    title="Voice Challenge AI Backend",
    version="1.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# WHISPER
#
# Render Free has 512 MB RAM, so the model is created only
# while transcription is running and released afterwards.
# "tiny" is the safest default for the free instance.
# =========================================================

WHISPER_MODEL_NAME = os.getenv(
    "WHISPER_MODEL",
    "tiny",
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
        "whisper": "on-demand",
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
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )


# =========================================================
# LOW-MEMORY WAVEFORM
#
# Reads only one waveform bucket at a time instead of loading
# the entire WAV into RAM and expanding it into a huge tuple.
# =========================================================

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
# TRANSCRIPTION
# =========================================================

def normalize_language(language):
    language = (language or "auto").strip().lower()

    if language in {"ar", "en"}:
        return language

    return None


def transcribe_audio(audio_path, language="auto"):
    forced_language = normalize_language(language)

    whisper_model = None

    try:
        whisper_model = WhisperModel(
            WHISPER_MODEL_NAME,
            device="cpu",
            compute_type="int8",
            cpu_threads=1,
            num_workers=1,
        )

        segments, info = whisper_model.transcribe(
            audio_path,
            language=forced_language,
            task="transcribe",

            # beam_size=1 sharply reduces decoder memory compared
            # with the previous beam_size=5.
            beam_size=1,

            temperature=0,
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 300,
            },

            # Keep this because VOX needs precise dialogue timing.
            word_timestamps=True,

            condition_on_previous_text=False,
        )

        transcript_segments = []

        # Consume the generator while the model is alive.
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

    finally:
        if whisper_model is not None:
            del whisper_model

        gc.collect()


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
#
# The old version did:
#   content = await video.read()
# which held the entire uploaded video in RAM.
# This version writes 1 MB chunks directly to disk.
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
        suffix=".wav",
    )

    video_path = video_temp.name
    audio_path = audio_temp.name

    video_temp.close()
    audio_temp.close()

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
        try:
            await video.close()
        except Exception:
            pass

        if os.path.exists(video_path):
            os.remove(video_path)

        if os.path.exists(audio_path):
            os.remove(audio_path)

        gc.collect()
