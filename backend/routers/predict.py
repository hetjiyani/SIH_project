"""
AgriSmart AI — /predict Router (Core Task)
POST /predict — Upload a leaf/crop image → disease classification result.
"""

import io
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, File, UploadFile, HTTPException
from PIL import Image

from models.schemas import PredictionResponse
from services.disease_service import predict_disease

router = APIRouter(prefix="/predict", tags=["Core — Disease Detection"])
logger = logging.getLogger(__name__)

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff"}
MAX_FILE_SIZE_MB = 10


@router.post(
    "",
    response_model=PredictionResponse,
    summary="Detect crop disease from a leaf/crop image",
    description=(
        "**Core Task** — Upload a leaf or crop image (JPEG/PNG/WebP, max 10 MB). "
        "Returns the predicted disease class, confidence score, is_healthy flag, "
        "and actionable precaution text for the farmer."
    ),
)
async def predict(
    file: UploadFile = File(..., description="Leaf/crop image (JPEG, PNG, or WebP)")
):
    # ── Validate content type ──────────────────────────────────────────────
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type: {file.content_type}. Please upload JPEG, PNG, or WebP.",
        )

    # ── Read bytes ─────────────────────────────────────────────────────────
    image_bytes = await file.read()

    if len(image_bytes) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {MAX_FILE_SIZE_MB} MB.",
        )

    # ── Validate as image ──────────────────────────────────────────────────
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.verify()  # raises if not a valid image
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid or corrupted image file: {str(e)}",
        )

    # ── Run prediction ─────────────────────────────────────────────────────
    try:
        result = predict_disease(image_bytes)
    except Exception as e:
        logger.exception("Prediction error")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

    if not result.get("is_valid", True):
        raise HTTPException(
            status_code=422,
            detail=(
                f"Image rejected: {result.get('message', 'No valid plant leaf detected.')} "
                f"Retry: {result.get('retry_message', 'Please retry by uploading a clear photo of an agricultural crop leaf.')}"
            ),
        )

    return PredictionResponse(
        label=result["label"],
        display_name=result["display_name"],
        confidence=result["confidence"],
        is_healthy=result["is_healthy"],
        precaution=result["precaution"],
        timestamp=datetime.now(timezone.utc).isoformat(),
        model_mode=result["model_mode"],
    )
