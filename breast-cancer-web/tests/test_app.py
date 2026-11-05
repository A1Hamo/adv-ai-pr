"""Tests for the web app. They train a tiny model on synthetic data, so no dataset is needed:
    python -m pip install -r requirements-dev.txt
    python -m pytest -q tests"""
import json

import joblib
import numpy as np
import pandas as pd
import pytest
from sklearn.impute import SimpleImputer
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import app as app_module

FEATURES = app_module.FEATURES
VALID = {"clump_thickness": 8, "uniformity_cell_size": 10, "uniformity_cell_shape": 10,
         "marginal_adhesion": 8, "single_epithelial_cell_size": 6, "bare_nuclei": 10,
         "bland_chromatin": 7, "normal_nucleoli": 10, "mitoses": 1}
PAGES = ["/", "/analyzer", "/performance", "/technology", "/developers", "/about", "/contact", "/privacy", "/terms"]


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    rng = np.random.default_rng(0)
    y = rng.random(400) < 0.35
    X = np.where(y[:, None], rng.integers(3, 11, (400, 9)), rng.integers(1, 4, (400, 9))).astype(float)
    X[rng.choice(400, 10), 5] = np.nan
    pipe = Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler()),
                     ("model", MLPClassifier(hidden_layer_sizes=(8,), max_iter=800, random_state=0))])
    pipe.fit(pd.DataFrame(X, columns=FEATURES), y.astype(int))
    tmp = tmp_path_factory.mktemp("app")
    joblib.dump({"pipeline": pipe, "features": FEATURES}, tmp / "model.joblib")
    app_module.MODEL_PATH = tmp / "model.joblib"
    app_module.METRICS_PATH = tmp / "metrics.json"
    app_module.INSTANCE = tmp / "instance"
    app_module._bundle = None
    app_module.app.testing = True
    return app_module.app.test_client()


def post(client, features):
    return client.post("/api/predict", json={"features": features})


@pytest.mark.parametrize("lang", ["en", "ar"])
@pytest.mark.parametrize("path", PAGES)
def test_pages_render(client, path, lang):
    client.set_cookie("lang", lang)
    r = client.get(path)
    assert r.status_code == 200
    assert f'lang="{lang}"'.encode() in r.data
    assert b"Content-Security-Policy" in str(r.headers).encode()


def test_language_switch_sets_cookie_and_redirects(client):
    r = client.get("/about?lang=ar")
    assert r.status_code == 302 and r.headers["Location"] == "/about"
    assert "lang=ar" in r.headers["Set-Cookie"]


def test_404_page_and_api_404(client):
    assert client.get("/nope").status_code == 404
    assert client.get("/api/nope").get_json()["error"] == "Not found"


def test_robots_and_sitemap(client):
    assert "Sitemap:" in client.get("/robots.txt").text
    assert "<loc>" in client.get("/sitemap.xml").text


def test_health(client):
    assert client.get("/health").get_json()["model_ready"] is True


def test_predict_ok(client):
    r = post(client, VALID)
    data = r.get_json()
    assert r.status_code == 200
    assert data["label"] in {"benign", "malignant"}
    assert abs(data["probability_malignant"] + data["probability_benign"] - 1) < 1e-3
    assert len(data["explanation"]) == 9
    assert data["confidence"] in {"high", "moderate", "uncertain"}


def test_extremes_are_classified_sensibly(client):
    assert post(client, {k: 1 for k in FEATURES}).get_json()["label"] == "benign"
    assert post(client, {k: 10 for k in FEATURES}).get_json()["label"] == "malignant"


def test_bare_nuclei_optional(client):
    r = post(client, dict(VALID, bare_nuclei=None))
    assert r.status_code == 200 and r.get_json()["imputed"] == ["bare_nuclei"]


@pytest.mark.parametrize("bad", [
    dict(VALID, mitoses=11), dict(VALID, mitoses=0), dict(VALID, mitoses=2.5),
    dict(VALID, mitoses="abc"), dict(VALID, mitoses=True), dict(VALID, mitoses=None),
])
def test_invalid_values_rejected(client, bad):
    assert post(client, bad).status_code == 400


def test_bad_payloads(client):
    assert client.post("/api/predict", data="hello").status_code == 400
    assert client.post("/api/predict", json=[1, 2, 3]).status_code == 400
    assert client.post("/api/predict", data="x" * (2 * 1024 * 1024), content_type="application/json").status_code == 413
    assert client.get("/api/predict").status_code == 405


def test_batch_mixed_rows(client):
    rows = [{"id": "ok-1", "features": VALID}, {"id": "bad", "features": dict(VALID, mitoses=99)},
            {"features": {k: 1 for k in FEATURES}}]
    r = client.post("/api/predict/batch", json={"rows": rows})
    data = r.get_json()
    assert r.status_code == 200
    assert data["summary"]["rows"] == 3 and data["summary"]["ok"] == 2 and data["summary"]["errors"] == 1
    assert data["results"][1]["status"] == "error" and "mitoses" in data["results"][1]["error"]
    assert data["results"][0]["id"] == "ok-1" and data["results"][2]["id"] is None


def test_batch_limits(client):
    assert client.post("/api/predict/batch", json={"rows": []}).status_code == 400
    assert client.post("/api/predict/batch", json={"nope": 1}).status_code == 400
    too_many = [{"features": VALID}] * (app_module.config.MAX_BATCH_ROWS + 1)
    assert client.post("/api/predict/batch", json={"rows": too_many}).status_code == 400


def test_contact_flow(client):
    good = {"name": "Ada Lovelace", "email": "ada@example.com", "organization": "Lab", "topic": "product",
            "message": "Hello, I would like to know more about the API."}
    assert client.post("/api/contact", json=good).get_json() == {"ok": True}
    saved = (app_module.INSTANCE / "contact_messages.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert json.loads(saved[-1])["email"] == "ada@example.com"
    bad = client.post("/api/contact", json=dict(good, email="nope", message="short"))
    assert bad.status_code == 400 and set(bad.get_json()["fields"]) == {"email", "message"}


def test_contact_honeypot_is_silent(client):
    before = (app_module.INSTANCE / "contact_messages.jsonl").read_text(encoding="utf-8")
    r = client.post("/api/contact", json={"name": "Bot", "email": "b@x.com", "message": "spam spam spam spam", "website": "http://x"})
    assert r.get_json() == {"ok": True}
    assert (app_module.INSTANCE / "contact_messages.jsonl").read_text(encoding="utf-8") == before


def test_rate_limit(client):
    app_module.app.testing = False
    try:
        codes = [client.post("/api/contact", json={}).status_code for _ in range(7)]
    finally:
        app_module.app.testing = True
        app_module.limiter.hits.clear()
    assert 429 in codes


def test_contact_webhook_receives_message(client):
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            received.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(204)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    entry = {"topic": "product", "name": "Ada", "email": "ada@example.com", "organization": "", "message": "Hello there, webhook!"}
    app_module.config.CONTACT_WEBHOOK_URL = f"http://127.0.0.1:{server.server_port}/hook"
    try:
        app_module._notify_webhook(entry)
    finally:
        app_module.config.CONTACT_WEBHOOK_URL = ""
        server.shutdown()
    assert received and received[0]["email"] == "ada@example.com" and "Hello there" in received[0]["text"]
