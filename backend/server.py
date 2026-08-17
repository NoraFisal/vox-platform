from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from main import app as ai_app
from audio_mix_server import app as mix_app
from room_server import app as rooms_app
from account_server import app as accounts_app

app = FastAPI(title="VOX Platform Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {
        "status": "ok",
        "service": "VOX Platform Backend",
        "routes": {
            "ai": "/api",
            "mix": "/api-mix",
            "rooms": "/rooms-api",
            "accounts": "/accounts-api",
        },
    }

@app.get("/health")
def health():
    return {"status": "ok"}

app.mount("/api", ai_app)
app.mount("/api-mix", mix_app)
app.mount("/rooms-api", rooms_app)
app.mount("/accounts-api", accounts_app)
