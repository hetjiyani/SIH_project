"""
Integration test suite for Frontend API Adapter endpoints (/api/*).
"""

import asyncio
import httpx
from main import app

async def run_tests():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        print("=" * 60)
        print("TESTING FRONTEND ADAPTER (/api/*) ENDPOINTS")
        print("=" * 60)

        # 1. Health check
        res = await client.get("/")
        print(f"[1/8] GET / -> Status {res.status_code}")
        assert res.status_code == 200

        # 2. Disease Predict (Test with real leaf photo)
        from pathlib import Path
        test_img_path = Path(__file__).resolve().parent.parent / "Test Images" / "Test.jpeg"
        if test_img_path.exists():
            files = {"image": ("test_leaf.jpg", test_img_path.read_bytes(), "image/jpeg")}
        else:
            files = {"image": ("test_leaf.jpg", b"fake_image_bytes", "image/jpeg")}
        data = {"crop_type": "Tomato", "soil_moisture": "68", "temperature": "27"}
        res = await client.post("/api/predict-disease", files=files, data=data)
        d = res.json()
        print(f"[2/8] POST /api/predict-disease -> Status {res.status_code} | Disease: {d.get('disease')} | Status: {d.get('status')}")
        assert "disease" in d and "confidence" in d and "status" in d

        # 2b. Non-crop rejection test
        res_fake = await client.post("/api/predict-disease", files={"image": ("non_leaf.jpg", b"fake_bytes", "image/jpeg")}, data=data)
        d_fake = res_fake.json()
        assert d_fake.get("status") == "invalid_image", "Expected non-crop bytes to be rejected"

        # 3. Crop Recommendation
        crop_payload = {"ph": 6.4, "moisture": 68, "temperature": 27, "rainProb": 65, "soilType": "Loamy"}
        res = await client.post("/api/recommend-crop", json=crop_payload)
        d = res.json()
        top_name = d["recommendations"][0]["name"]
        print(f"[3/8] POST /api/recommend-crop -> Status {res.status_code} | Top crop: {top_name}")
        assert "recommendations" in d and len(d["recommendations"]) > 0

        # 4. Smart Irrigation
        res = await client.get("/api/irrigation/advice?moisture=42&rain_prob=65&temp=28&crop=Tomato")
        d = res.json()
        print(f"[4/8] GET /api/irrigation/advice -> Status {res.status_code} | Decision: {d.get('decision')}")
        assert "needed" in d and "decision" in d and "metrics" in d

        # 5. Weather Advisory
        res = await client.get("/api/weather/advisory?location=Nashik%20Valley%2C%20MH")
        d = res.json()
        temp_val = d["current"]["temp"]
        banners_cnt = len(d["actionBanners"])
        print(f"[5/8] GET /api/weather/advisory -> Status {res.status_code} | Temp: {temp_val}C | Banners: {banners_cnt}")
        assert "current" in d and "actionBanners" in d and "forecast" in d

        # 6. Sustainability Score
        res = await client.post("/api/sustainability/score", json={"crop": "Tomato"})
        d = res.json()
        print(f"[6/8] POST /api/sustainability/score -> Status {res.status_code} | Score: {d['overallScore']} | Grade: {d['grade']}")
        assert "overallScore" in d and "breakdown" in d and "suggestions" in d

        # 7. Farmer Assistant
        res = await client.post("/api/assistant/chat", json={"query": "How do I manage Early Blight organically?", "language": "en"})
        d = res.json()
        ans_preview = d["text"][:50]
        print(f"[7/8] POST /api/assistant/chat -> Status {res.status_code} | Response: {ans_preview}...")
        assert "text" in d and "timestamp" in d

        # 8. Agentic Feed & Trigger
        res = await client.get("/api/agentic/feed")
        d = res.json()
        print(f"[8/8] GET /api/agentic/feed -> Status {res.status_code} | Feed events: {len(d)}")
        assert isinstance(d, list)

        print("\n" + "=" * 60)
        print("ALL 8 FRONTEND ADAPTER INTEGRATION TESTS PASSED SUCCESSFULLY!")
        print("=" * 60)

if __name__ == "__main__":
    asyncio.run(run_tests())
