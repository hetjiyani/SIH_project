"""
AgriSmart AI — FastAPI Application Entry Point
SIH 2026, Problem Statement C-433
Team: Member 2 (Backend)

Endpoints:
  GET  /                → health check
  POST /predict         → core disease detection (mandatory)
  POST /recommend-crop  → crop recommendation (bonus A)
  POST /irrigation      → irrigation prediction (bonus B)
  GET  /weather-advice  → weather intelligence (bonus C)
  POST /sustainability  → sustainability score (bonus D)
  POST /assistant       → farmer AI assistant (bonus E)
  GET  /agent/advisories → recent agentic advisories (bonus G)

Run:
  cd backend
  uvicorn main:app --reload --host 0.0.0.0 --port 8000

Docs: http://localhost:8000/docs
"""

import logging
import os
import sys
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import datetime, timezone

# Ensure backend directory is in sys.path so imports work regardless of working directory
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ─── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ─── Routers ───────────────────────────────────────────────────────────────────
from routers import predict, crop, irrigation, weather, sustainability, assistant, api_adapter

# ─── Services ──────────────────────────────────────────────────────────────────
from services.disease_service import load_model
from scheduler.agentic_loop import create_scheduler, get_recent_advisories

APP_VERSION = "1.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle management."""
    # ── Startup ──────────────────────────────────────────────────────────────
    logger.info("🌱 AgriSmart AI Backend starting up...")

    # Load ML model (mock or real based on MODEL_MODE env var)
    load_model()
    logger.info("✅ Disease model loaded.")

    # Start agentic advisor scheduler (Bonus G)
    scheduler = create_scheduler()
    scheduler.start()
    app.state.scheduler = scheduler
    logger.info("✅ Agentic advisor scheduler started (every 30 minutes).")

    logger.info(f"🚀 AgriSmart AI v{APP_VERSION} is ready at http://localhost:8000")
    logger.info("📖 API docs: http://localhost:8000/docs")

    yield  # Application runs

    # ── Shutdown ─────────────────────────────────────────────────────────────
    logger.info("🛑 Shutting down AgriSmart AI...")
    if hasattr(app.state, "scheduler"):
        app.state.scheduler.shutdown(wait=False)
    logger.info("👋 Goodbye!")


# ─── FastAPI App ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="AgriSmart AI — Backend API",
    description=(
        "**AgriSmart AI** is an intelligent agriculture platform for SIH 2026 (C-433). \n\n"
        "It provides AI-powered crop disease detection from leaf images, plus bonus modules for "
        "crop recommendation, smart irrigation, weather intelligence, sustainability scoring, "
        "and a GenAI-powered farmer assistant.\n\n"
        "**Core Task**: Upload a leaf/crop image to `/predict` or `/api/predict-disease` to detect disease.\n\n"
        "**Data Source**: Live weather from Open-Meteo (open-meteo.com — no API key required).\n\n"
        "**AI Assistant**: Powered by Google Gemini with grounded context injection."
    ),
    version=APP_VERSION,
    contact={
        "name": "AgriSmart AI Team (SIH 2026, C-433)",
        "url": "https://github.com/ManavVora26/AgriSmart-AI",
    },
    license_info={
        "name": "MIT License",
        "url": "https://opensource.org/licenses/MIT",
    },
    lifespan=lifespan,
)

# ─── CORS Middleware ────────────────────────────────────────────────────────────
# Allows the frontend (Member 1) to call the backend from any origin during development.
# In production, replace "*" with your actual frontend domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ─── Register Routers ───────────────────────────────────────────────────────────
app.include_router(predict.router)
app.include_router(crop.router)
app.include_router(irrigation.router)
app.include_router(weather.router)
app.include_router(sustainability.router)
app.include_router(assistant.router)
app.include_router(api_adapter.router)  # Frontend Web Adapter (matches /api/*)

from fastapi.staticfiles import StaticFiles
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
if os.path.exists(frontend_dir):
    app.mount("/frontend", StaticFiles(directory=frontend_dir, html=True), name="frontend")
    logger.info(f"Mounted static frontend from {frontend_dir} at /frontend")


# ─── Health Check & Root Redirect ─────────────────────────────────────────────
@app.get(
    "/health",
    tags=["Health"],
    summary="Health check",
    description="Returns server status and available endpoints.",
    response_class=JSONResponse,
)
async def health_check():
    model_mode = os.getenv("MODEL_MODE", "mock")
    return {
        "status": "ok",
        "service": "AgriSmart AI Backend",
        "version": APP_VERSION,
        "model_mode": model_mode,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "endpoints": {
            "core": "POST /predict",
            "bonus_a": "POST /recommend-crop",
            "bonus_b": "POST /irrigation",
            "bonus_c": "GET /weather-advice",
            "bonus_d": "POST /sustainability",
            "bonus_e": "POST /assistant",
            "bonus_g": "GET /agent/advisories",
            "docs": "GET /docs",
            "frontend": "GET /frontend/index.html",
        },
        "weather_source": "Open-Meteo (open-meteo.com) — no API key required",
        "ai_assistant": "Google Gemini 1.5 Flash",
    }


@app.get("/", include_in_schema=False)
async def root(request: Request):
    """Redirect browser visits directly to the frontend web app, while returning JSON for API clients."""
    accept = request.headers.get("accept", "")
    if "text/html" in accept and not accept.startswith("application/json"):
        return RedirectResponse(url="/frontend/index.html")
    return await health_check()


# ─── Bonus G — Agentic Advisor ──────────────────────────────────────────────────
@app.get(
    "/agent/advisories",
    tags=["Bonus G — Agentic Advisor"],
    summary="View recent agentic advisor outputs",
    description=(
        "**Bonus G** — Returns recent automated advisories generated by the agentic advisor loop. "
        "The advisor runs every 30 minutes, checks weather and farm conditions, "
        "and generates consolidated farm recommendations autonomously."
    ),
)
async def get_advisories(limit: int = 20):
    advisories = get_recent_advisories(limit=limit)
    return {
        "count": len(advisories),
        "scheduler": "APScheduler (every 30 minutes)",
        "description": "Autonomous farm advisories generated by the agentic loop (Bonus G)",
        "advisories": advisories,
    }
