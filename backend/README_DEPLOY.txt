VOX backend deployment bundle

Start command:
uvicorn server:app --host 0.0.0.0 --port $PORT

Routes:
 /api
 /api-mix
 /rooms-api
 /accounts-api

The deployment host must provide ffmpeg/ffprobe.
SQLite databases and generated media currently use local disk.
