# Run this ONCE inside your existing backend virtual environment.

cd D:\voice-challenge\backend
.\.venv\Scripts\Activate.ps1

python -m pip install -U demucs

# Test Demucs:
python -m demucs --help

# Then run the new mix service in a SECOND backend terminal:
python -m uvicorn audio_mix_server:app --reload --port 8002
