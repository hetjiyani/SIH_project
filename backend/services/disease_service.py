"""
AgriSmart AI — Disease Detection Service
Handles PyTorch EfficientNet-B0 model loading and real inference for crop disease classification.

Supports 38 crop-pathology classes from PlantVillage.
Weights loaded from: model/best_agri_model.pth
"""

import os
import io
import random
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

from PIL import Image
import numpy as np
from dotenv import load_dotenv

from utils.label_map import INDEX_TO_LABEL, LABEL_TO_INDEX, get_label_info, NUM_CLASSES

load_dotenv()

logger = logging.getLogger(__name__)

MODEL_MODE = os.getenv("MODEL_MODE", "real").lower()
MODEL_WEIGHTS_PATH = os.getenv("MODEL_WEIGHTS_PATH", "../model/best_agri_model.pth")

# Global model holder
_model = None
_transform = None
_device = None
_loaded_path = None


def _find_weights_file() -> Optional[Path]:
    """Search candidate paths for the model weights file."""
    candidates = [
        Path(MODEL_WEIGHTS_PATH),
        Path("../model/best_agri_model.pth"),
        Path("model/best_agri_model.pth"),
        Path(__file__).resolve().parent.parent.parent / "model" / "best_agri_model.pth",
        Path("model_weights/best_agri_model.pth"),
        Path("model_weights/disease_model.pt"),
    ]
    for p in candidates:
        if p.exists() and p.is_file():
            return p.resolve()
    return None


def _load_real_model() -> bool:
    """Load EfficientNet-B0 with trained weights from disk using PyTorch & Torchvision."""
    global _model, _transform, _device, _loaded_path
    try:
        import torch
        import torch.nn as nn
        import torchvision.models as models
        from torchvision import transforms

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        weights_path = _find_weights_file()

        if not weights_path:
            logger.warning(
                f"Model weights not found at any candidate path. "
                "Set MODEL_MODE=mock or ensure model/best_agri_model.pth exists."
            )
            return False

        logger.info(f"Loading real EfficientNet-B0 model from {weights_path} on {device}...")

        # Construct EfficientNet-B0 with 38 classes
        model = models.efficientnet_b0(weights=None)
        in_features = model.classifier[1].in_features  # 1280
        model.classifier[1] = nn.Linear(in_features, NUM_CLASSES)

        checkpoint = torch.load(weights_path, map_location=device)
        state_dict = checkpoint.get("model_state_dict", checkpoint)

        # Load weights
        model.load_state_dict(state_dict, strict=True)
        model.to(device)
        model.eval()

        transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225]
            ),
        ])

        _model = model
        _device = device
        _transform = transform
        _loaded_path = str(weights_path)
        logger.info(f"Real model successfully loaded from {_loaded_path} ({NUM_CLASSES} classes).")
        return True

    except Exception as e:
        logger.error(f"Failed to load real model: {e}. Falling back to mock mode.", exc_info=True)
        _model = None
        return False


def load_model():
    """Initialize the model at server startup."""
    global _model
    if MODEL_MODE == "real":
        success = _load_real_model()
        if not success:
            logger.warning("Real model load failed — falling back to mock mode.")
    else:
        logger.info("Running in MOCK mode — no model weights needed.")


def _mock_predict(image_bytes: bytes) -> dict:
    """Stub prediction: returns a deterministic-ish result seeded by image content."""
    try:
        if image_bytes and len(image_bytes) > 0:
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize((64, 64))
            arr = np.array(img)
            seed = int(arr.mean() * 1000) % (NUM_CLASSES * 100)
        else:
            seed = 42
    except Exception:
        seed = sum(image_bytes) if image_bytes else 42

    rng = random.Random(seed)
    class_idx = rng.randint(0, NUM_CLASSES - 1)
    label = INDEX_TO_LABEL[class_idx]

    # Generate probabilities where dominant class has realistic high confidence (85% - 96%)
    raw = [rng.uniform(0.001, 0.005) for _ in range(NUM_CLASSES)]
    target_conf = rng.uniform(0.85, 0.96)
    raw[class_idx] = (target_conf / (1.0 - target_conf)) * sum(raw)
    total = sum(raw)
    probs = [r / total for r in raw]
    confidence = probs[class_idx]

    sorted_indices = sorted(range(NUM_CLASSES), key=lambda i: probs[i], reverse=True)
    top_3 = [
        {
            "label": INDEX_TO_LABEL[i],
            "display_name": get_label_info(INDEX_TO_LABEL[i])["display_name"],
            "confidence": round(probs[i] * 100, 1),
        }
        for i in sorted_indices[:3]
    ]

    return {
        "label": label,
        "confidence": round(confidence, 4),
        "top_3": top_3,
        "all_probabilities": {INDEX_TO_LABEL[i]: round(probs[i], 4) for i in range(NUM_CLASSES)},
    }


def _real_predict(image_bytes: bytes) -> dict:
    """Run actual EfficientNet-B0 inference on the uploaded image bytes."""
    import torch
    import torch.nn.functional as F

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    tensor = _transform(img).unsqueeze(0).to(_device)

    with torch.no_grad():
        logits = _model(tensor)
        probs = F.softmax(logits, dim=1)[0]
        confidence, class_idx = probs.max(dim=0)

    topk = torch.topk(probs, k=min(3, NUM_CLASSES))
    top_3 = [
        {
            "label": INDEX_TO_LABEL[int(topk.indices[i])],
            "display_name": get_label_info(INDEX_TO_LABEL[int(topk.indices[i])])["display_name"],
            "confidence": round(float(topk.values[i]) * 100, 1),
        }
        for i in range(len(topk.indices))
    ]

    label = INDEX_TO_LABEL[int(class_idx)]
    return {
        "label": label,
        "confidence": round(float(confidence), 4),
        "top_3": top_3,
        "all_probabilities": {INDEX_TO_LABEL[i]: round(float(probs[i]), 4) for i in range(NUM_CLASSES)},
    }


GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")


def _check_gemini_vision_leaf(image_bytes: bytes) -> Optional[dict]:
    """
    Uses Google Gemini Vision to accurately check if the image is a plant leaf
    or an out-of-domain object (car, human, animal, document, room, etc.).
    """
    if not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here":
        return None

    try:
        from google import genai
        from google.genai import types
        import json

        client = genai.Client(api_key=GEMINI_API_KEY)

        # Detect mime type
        mime_type = "image/jpeg"
        if image_bytes.startswith(b"\x89PNG"):
            mime_type = "image/png"
        elif image_bytes.startswith(b"RIFF") and b"WEBP" in image_bytes[:16]:
            mime_type = "image/webp"

        prompt = (
            "Analyze this image carefully for an agricultural plant pathology system.\n"
            "Question: Does this image depict a real plant leaf, crop foliage, plant stem, or agricultural specimen "
            "suitable for plant pathology or disease identification?\n"
            "Important: If the image shows a plant leaf, crop plant, foliage, or a leaf held by hand or on soil/table, "
            "mark is_leaf as true even if diseased, yellowed, spotted, wilted, or imperfect.\n"
            "Only if it depicts an obvious non-plant object (e.g. human face/selfie without plants, animal/pet, vehicle, car, "
            "indoor furniture, document/invoice, phone, screen), mark is_leaf as false.\n\n"
            "Respond strictly in valid JSON format without markdown code fences:\n"
            "{\n"
            '  "is_leaf": true,\n'
            '  "subject": "brief 2-4 word description of what image shows",\n'
            '  "reason": "short 1-sentence reason why it is or is not an agricultural crop leaf",\n'
            '  "retry_advice": "clear instruction for the farmer on how to retry with a real crop leaf photo"\n'
            "}"
        )

        models_to_try = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
        for m in models_to_try:
            try:
                resp = client.models.generate_content(
                    model=m,
                    contents=[
                        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                        prompt
                    ]
                )
                if resp and resp.text:
                    text = resp.text.strip()
                    if text.startswith("```"):
                        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
                    data = json.loads(text)
                    return data
            except Exception as e_candidate:
                logger.debug(f"Gemini leaf check with model {m} failed: {e_candidate}")
                continue

    except Exception as e:
        logger.warning(f"Gemini leaf validation error: {e}")

    return None


def validate_leaf_image(image_bytes: bytes, **kwargs) -> dict:
    """
    Validates that the uploaded image contains plant foliage/leaves and meets minimum quality thresholds.
    Validation is strictly visual and content-based (never reliant on file name).
    Rejects:
      1. Empty or corrupted files
      2. Images smaller than 40x40 pixels
      3. Solid/monotone images (no texture variation, std_dev < 7.0)
      4. Explicit non-plant objects (unnatural blue/cyan dominance, Gemini Vision, or vegetation_ratio < 0.08)
    """
    if not image_bytes or len(image_bytes) < 100:
        return {
            "is_valid": False,
            "reason": "empty_file",
            "message": "Empty or corrupted image file received.",
            "retry_message": "Please retry by uploading a valid JPEG, PNG, or WebP photo of a crop leaf.",
            "suggestions": ["Please upload a valid JPEG, PNG, or WebP photo."],
            "vegetation_ratio": 0.0,
        }

    try:
        img = Image.open(io.BytesIO(image_bytes))
        width, height = img.size

        # 1. Size check: must be at least 40x40
        if width < 40 or height < 40:
            return {
                "is_valid": False,
                "reason": "too_small",
                "message": f"Image resolution is too low ({width}x{height} px). Minimum required is 40x40 px.",
                "retry_message": "Please retry by uploading a higher-resolution close-up photo of the leaf.",
                "suggestions": ["Please upload a higher-resolution close-up photo of the leaf."],
                "vegetation_ratio": 0.0,
            }

        # Convert to RGB and resize for fast color analysis
        rgb_img = img.convert("RGB").resize((128, 128))
        rgb_arr = np.array(rgb_img, dtype=np.float32)

        # 2. Monotone / Blank check (std dev across pixels)
        std_dev = float(np.std(rgb_arr))
        if std_dev < 7.0:
            return {
                "is_valid": False,
                "reason": "monotone_or_blank",
                "message": "The uploaded image appears blank, solid-colored, or lacks discernible leaf texture.",
                "retry_message": "Please ensure the camera lens is unobstructed and captures clear leaf surface, then retry.",
                "suggestions": ["Ensure camera lens is unobstructed and captures clear leaf surface."],
                "vegetation_ratio": 0.0,
            }

        # 3. Organic Plant Spectrum Analysis (HSV space)
        hsv_img = rgb_img.convert("HSV")
        hsv_arr = np.array(hsv_img, dtype=np.uint8)
        H = hsv_arr[:, :, 0]  # In PIL, H is 0-255 (0 to 360 mapped to 0-255)
        S = hsv_arr[:, :, 1]  # 0-255
        V = hsv_arr[:, :, 2]  # 0-255

        # Green / lime / yellow-green / olive / forest foliage
        green_mask = (H >= 20) & (H <= 128) & (S >= 14) & (V >= 14)
        # Chlorotic yellow / amber / golden foliage
        yellow_mask = (H >= 12) & (H < 38) & (S >= 16) & (V >= 18)
        # Brown / necrotic lesions / blight / rust pustules
        brown_mask = (H >= 4) & (H < 28) & (S >= 14) & (V >= 10) & (V <= 230)
        # Dark necrotic / black rot spots (low brightness organic tones)
        dark_spot_mask = (H >= 2) & (H <= 45) & (S >= 6) & (V >= 6) & (V <= 80)
        # Red / purple anthocyanins / leaf curl / stress
        red_purple_mask = ((H <= 12) | (H >= 235)) & (S >= 18) & (V >= 18)
        # Powdery mildew / silvery lesions
        mildew_mask = (H >= 18) & (H <= 135) & (S >= 6) & (S <= 45) & (V >= 60)

        # Unnatural non-plant color indicator: Blue / Cyan (sky, clothing, vehicles, electronic screens)
        blue_cyan_mask = (H >= 130) & (H <= 185) & (S >= 30) & (V >= 30)
        blue_cyan_ratio = float(np.sum(blue_cyan_mask)) / float(blue_cyan_mask.size)

        plant_mask = green_mask | yellow_mask | brown_mask | dark_spot_mask | red_purple_mask | mildew_mask
        vegetation_ratio = float(np.sum(plant_mask)) / float(plant_mask.size)

        # Non-plant dominance: if blue/cyan exceeds 40% and foliage is under 15%
        if blue_cyan_ratio > 0.40 and vegetation_ratio < 0.15:
            return {
                "is_valid": False,
                "reason": "no_plant_detected",
                "detected_subject": "Non-plant object / background",
                "message": (
                    f"Non-crop image detected (dominant non-plant colors: {round(blue_cyan_ratio * 100, 1)}%). "
                    "The image does not appear to be agricultural crop foliage."
                ),
                "retry_message": "Please upload a close-up photo focusing directly on a crop leaf rather than sky, background, or objects.",
                "suggestions": [
                    "Take a close-up photo of a single crop leaf.",
                    "Avoid background objects, sky, or synthetic items in the frame.",
                    "Focus camera directly on the leaf surface.",
                ],
                "vegetation_ratio": round(vegetation_ratio, 3),
            }

        # 4. Gemini Vision Guardrail (if API key available and not default placeholder)
        if GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here":
            if vegetation_ratio < 0.25:
                gemini_check = _check_gemini_vision_leaf(image_bytes)
                if gemini_check is not None and not gemini_check.get("is_leaf", False):
                    subj = gemini_check.get("subject", "non-plant subject")
                    reason = gemini_check.get("reason", "The image does not contain agricultural crop foliage.")
                    retry_adv = gemini_check.get("retry_advice", "Please retry by uploading a close-up photo of a crop leaf.")
                    return {
                        "is_valid": False,
                        "reason": "no_plant_detected",
                        "detected_subject": subj,
                        "message": f"Non-crop image detected ({subj}). {reason}",
                        "retry_message": retry_adv,
                        "suggestions": [
                            "Take a close-up photo of a single crop leaf.",
                            "Ensure good natural daylight (avoid dark shadows or glare).",
                            "Focus camera directly on the affected leaf surface.",
                            "Ensure the subject is a supported agricultural plant (Tomato, Potato, Corn, Apple, etc.)."
                        ],
                        "vegetation_ratio": round(vegetation_ratio, 3),
                    }

        # 5. Plant threshold check: at least 8.0% of pixels must match organic leaf spectrum
        if vegetation_ratio < 0.08:
            return {
                "is_valid": False,
                "reason": "no_plant_detected",
                "message": (
                    f"No crop leaf detected (plant foliage index: {round(vegetation_ratio * 100, 1)}%). "
                    "The image does not contain recognizable plant leaves, chlorophyll, or foliar lesions."
                ),
                "retry_message": "Please retry by uploading a close-up photo of a single crop leaf in bright, natural light.",
                "suggestions": [
                    "Take a close-up photo of a single crop leaf.",
                    "Ensure good natural daylight (avoid dark shadows or glare).",
                    "Focus camera directly on the affected leaf surface.",
                    "Ensure the subject is a supported agricultural plant (Tomato, Potato, Corn, Apple, etc.)."
                ],
                "vegetation_ratio": round(vegetation_ratio, 3),
            }

        return {
            "is_valid": True,
            "reason": "valid_leaf",
            "message": "Foliage verified.",
            "retry_message": "",
            "suggestions": [],
            "vegetation_ratio": round(vegetation_ratio, 3),
        }

    except Exception as e:
        logger.warning(f"Leaf validation exception: {e}")
        return {
            "is_valid": False,
            "reason": "corrupted_image",
            "message": f"Could not decode image file: {str(e)}",
            "retry_message": "Please retry by uploading a valid JPEG, PNG, or WebP photo.",
            "suggestions": ["Please upload a valid JPEG, PNG, or WebP image."],
            "vegetation_ratio": 0.0,
        }


def predict_disease(image_bytes: bytes, **kwargs) -> dict:
    """
    Main entry point for disease prediction.
    Strictly evaluates the image content, without any filename-based bypasses.
    Enforces a minimum 50% confidence threshold:
    If confidence < 50% (0.50), flags the image as improper / invalid.
    """
    # Guardrail 1: Plant Foliage & Quality Validation (strictly visual)
    val = validate_leaf_image(image_bytes)

    # If plant guardrail rejected the image, immediately return invalid_image
    if not val["is_valid"]:
        return {
            "status": "invalid_image",
            "is_valid": False,
            "reason": val["reason"],
            "detected_subject": val.get("detected_subject", "Non-plant subject"),
            "message": val["message"],
            "retry_message": val.get("retry_message", "Please retry by uploading a clear close-up photo of an agricultural crop leaf."),
            "suggestions": val["suggestions"],
            "vegetation_ratio": val.get("vegetation_ratio", 0.0),
            "confidence": 0.0,
        }

    is_real = (_model is not None)
    if not is_real and MODEL_MODE == "real":
        is_real = _load_real_model()

    # Guardrail 2: Inference
    if is_real and image_bytes and len(image_bytes) > 0:
        try:
            raw = _real_predict(image_bytes)
            active_mode = "real"
        except Exception as e:
            logger.error(f"Inference error with real model: {e}. Falling back to mock.", exc_info=True)
            raw = _mock_predict(image_bytes)
            active_mode = "mock"
    else:
        raw = _mock_predict(image_bytes)
        active_mode = "mock"

    confidence = raw["confidence"]

    # Guardrail 3: Confidence threshold of 50% (0.50)
    # If the model confidence is lower than 50%, the image is NOT proper.
    if confidence < 0.50:
        info_guess = get_label_info(raw["label"])
        conf_pct = round(confidence * 100, 1)
        return {
            "status": "invalid_image",
            "is_valid": False,
            "reason": "improper_image",
            "confidence": confidence,
            "confidence_pct": conf_pct,
            "crop": info_guess.get("crop", "Unknown Crop"),
            "display_name": info_guess.get("display_name", "Uncertain"),
            "message": (
                f"The image is not proper (Diagnostic confidence: {conf_pct}% is below the required 50% threshold). "
                "The AI cannot clearly recognize an agricultural crop leaf or distinct disease symptoms."
            ),
            "retry_message": "The uploaded image is not proper. Please upload a clear, focused close-up photo of an agricultural crop leaf in good daylight and try again.",
            "suggestions": [
                "Ensure the photo clearly captures an agricultural crop leaf, not an unrelated object.",
                "Take a sharp, close-up photo focusing directly on the leaf symptoms.",
                "Ensure bright, even natural daylight without heavy shadows, glare, or blur.",
                "Make sure the plant belongs to our supported crop types (confidence must be at least 50%)."
            ],
            "vegetation_ratio": val.get("vegetation_ratio", 0.0),
            "top_3": raw.get("top_3", []),
            "model_mode": active_mode,
        }

    # Verified leaf with confidence >= 50%
    info = get_label_info(raw["label"])
    return {
        "status": "valid",
        "is_valid": True,
        "label": raw["label"],
        "crop": info.get("crop", "Unknown Crop"),
        "display_name": info["display_name"],
        "confidence": confidence,
        "is_healthy": info["is_healthy"],
        "is_low_confidence": False,
        "confidence_warning": "",
        "precaution": info["precaution"],
        "precautions": info.get("precautions", {}),
        "summary": info.get("summary", ""),
        "top_3": raw.get("top_3", []),
        "model_mode": active_mode,
        "model_path": _loaded_path if active_mode == "real" else None,
        "vegetation_ratio": val.get("vegetation_ratio", 1.0),
    }
