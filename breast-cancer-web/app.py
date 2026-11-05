"""Web application: Flask backend, JSON API and server-rendered, bilingual site."""
import json
import logging
import math
import re
import smtplib
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from email.message import EmailMessage
from functools import wraps
from pathlib import Path
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

import joblib
import numpy as np
import pandas as pd
from flask import Flask, Response, g, jsonify, redirect, render_template, request, url_for
from markupsafe import Markup
from werkzeug.middleware.proxy_fix import ProxyFix

import config

BASE = Path(__file__).resolve().parent
MODEL_PATH = BASE / "model" / "model.joblib"
METRICS_PATH = BASE / "model" / "metrics.json"
INSTANCE = BASE / "instance"

FEATURES = ["clump_thickness", "uniformity_cell_size", "uniformity_cell_shape",
            "marginal_adhesion", "single_epithelial_cell_size", "bare_nuclei",
            "bland_chromatin", "normal_nucleoli", "mitoses"]
OPTIONAL = {"bare_nuclei"}          # the original dataset has missing values here; the pipeline imputes them
THRESHOLD = 0.5
LANGS = ("en", "ar")
PAGES = [  # (endpoint, path, in sitemap)
    ("home", "/"), ("analyzer", "/analyzer"), ("performance", "/performance"), ("technology", "/technology"),
    ("developers", "/developers"), ("about", "/about"), ("contact", "/contact"),
    ("privacy", "/privacy"), ("terms", "/terms"),
]

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024
app.config["JSON_AS_ASCII"] = False
app.json.sort_keys = False
app.json.ensure_ascii = False
if config.TRUST_PROXY:
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("app")

# --------------------------------------------------------------------------- translations
TRANSLATIONS = {l: json.loads((BASE / "translations" / f"{l}.json").read_text(encoding="utf-8")) for l in LANGS}
JS_PREFIXES = ("js.", "f.", "g.", "m.", "b.", "pf.k_")


DEFAULT_TEST_METRICS = {"accuracy": 0.9712, "recall": 0.9583, "roc_auc": 0.9961}


def headline_stats():
    """Headline numbers for the site: taken from the deployed model's metrics when available."""
    info = read_metrics()
    m = info["test_metrics"] if info and "test_metrics" in info else DEFAULT_TEST_METRICS
    return {"acc": f"{m['accuracy'] * 100:.1f}%", "rec": f"{m['recall'] * 100:.1f}%", "auc": f"{m['roc_auc']:.3f}"}


def _fill(text):
    if "{" not in text:
        return text
    stats = headline_stats()
    for key, value in (("{brand}", config.BRAND["name"]), ("{company}", config.BRAND["company"]),
                       ("{year}", str(datetime.now().year)), ("{max}", f"{config.MAX_BATCH_ROWS:,}"),
                       ("{acc}", stats["acc"]), ("{rec}", stats["rec"]), ("{auc}", stats["auc"])):
        text = text.replace(key, value)
    return text


def translate(key, lang=None):
    lang = lang or getattr(g, "lang", "en")
    text = TRANSLATIONS[lang].get(key) or TRANSLATIONS["en"].get(key) or key
    return _fill(text)


def best_language():
    cookie = request.cookies.get("lang")
    if cookie in LANGS:
        return cookie
    return "ar" if request.accept_languages.best_match(["ar", "en"]) == "ar" else "en"


@app.before_request
def pick_language():
    wanted = request.args.get("lang")
    if wanted in LANGS and request.method == "GET" and not request.path.startswith("/api/"):
        rest = [(k, v) for k, v in request.args.items(multi=True) if k != "lang"]
        resp = redirect(request.path + ("?" + urlencode(rest) if rest else ""))
        resp.set_cookie("lang", wanted, max_age=31536000, samesite="Lax")
        return resp
    g.lang = best_language()


def asset(filename):
    """static URL with a cache-busting version taken from the file's modification time."""
    path = BASE / "static" / filename
    version = int(path.stat().st_mtime) if path.exists() else 0
    return url_for("static", filename=filename, v=version)


@app.context_processor
def inject_globals():
    lang = g.get("lang", "en")

    def t(key, **_):
        text = translate(key, lang)
        return Markup(text) if key.endswith("_html") else text

    js = {k: _fill(v) for k, v in TRANSLATIONS[lang].items() if k.startswith(JS_PREFIXES)}
    base_url = config.BRAND["site_url"] or request.url_root.rstrip("/")
    return {
        "t": t, "lang": lang, "dir": "rtl" if lang == "ar" else "ltr", "brand": config.BRAND,
        "year": datetime.now().year, "asset": asset, "js_i18n": js, "current_path": request.path,
        "canonical": base_url + request.path, "base_url": base_url,
        "other_lang": "ar" if lang == "en" else "en",
        "max_batch_rows": config.MAX_BATCH_ROWS,
    }


# --------------------------------------------------------------------------- model
_bundle = None


def get_bundle():
    """Load the trained pipeline once; return None if it has not been trained yet."""
    global _bundle
    if _bundle is None and MODEL_PATH.exists():
        _bundle = joblib.load(MODEL_PATH)
    return _bundle


def read_metrics():
    return json.loads(METRICS_PATH.read_text()) if METRICS_PATH.exists() else None


class InputError(ValueError):
    pass


def parse_features(feats):
    if not isinstance(feats, dict):
        raise InputError('Send JSON like {"features": {"clump_thickness": 5, ...}}')
    values, imputed = {}, []
    for name in FEATURES:
        raw = feats.get(name)
        if raw is None or raw == "":
            if name in OPTIONAL:
                values[name] = np.nan
                imputed.append(name)
                continue
            raise InputError(f"'{name}' is required.")
        if isinstance(raw, bool):
            raise InputError(f"'{name}' must be a whole number from 1 to 10.")
        try:
            num = float(raw)
        except (TypeError, ValueError):
            raise InputError(f"'{name}' must be a whole number from 1 to 10.") from None
        if not math.isfinite(num) or not 1 <= num <= 10 or num != int(num):
            raise InputError(f"'{name}' must be a whole number from 1 to 10.")
        values[name] = int(num)
    return values, imputed


def confidence_band(p):
    """Rough, human-readable band. It is NOT a calibrated clinical confidence."""
    if 0.35 < p < 0.65:
        return "uncertain"
    if p <= 0.10 or p >= 0.90:
        return "high"
    return "moderate"


def _logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def explain(bundle, values, p_full):
    """Occlusion explanation. Each feature is replaced, one at a time, by its training median and
    we measure how much the model's log-odds of 'malignant' change. Working in log-odds avoids the
    saturation of probabilities near 0 or 1. `influence` is each feature's signed share of the total
    absolute change (positive = pushes towards malignant); `effect` is the raw probability change."""
    pipe, features = bundle["pipeline"], bundle["features"]
    medians = dict(zip(features, pipe.named_steps["imputer"].statistics_))
    rows = []
    for name in features:
        row = dict(values)
        row[name] = medians[name]
        rows.append(row)
    probs = pipe.predict_proba(pd.DataFrame(rows, columns=features))[:, 1]
    delta = _logit(p_full) - _logit(probs)
    total = float(np.abs(delta).sum())
    out = []
    for name, p_alt, d in zip(features, probs, delta):
        value = values[name]
        out.append({"feature": name,
                    "value": None if (isinstance(value, float) and math.isnan(value)) else int(value),
                    "effect": round(float(p_full - p_alt), 4),
                    "influence": round(float(d / total), 4) if total > 0 else 0.0})
    out.sort(key=lambda d: abs(d["influence"]), reverse=True)
    return out


def result_dict(p):
    return {"label": "malignant" if p >= THRESHOLD else "benign",
            "probability_malignant": round(float(p), 4), "probability_benign": round(1 - float(p), 4),
            "confidence": confidence_band(p)}


# --------------------------------------------------------------------------- rate limiting
class RateLimiter:
    """Small in-memory sliding-window limiter (per client IP). Use a shared store for multi-worker setups."""
    def __init__(self):
        self.hits, self.lock = defaultdict(deque), threading.Lock()

    def allow(self, key, limit, window):
        now = time.monotonic()
        with self.lock:
            if len(self.hits) > 20000:
                self.hits = defaultdict(deque, {k: v for k, v in self.hits.items() if v and now - v[-1] < window})
            q = self.hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False, int(window - (now - q[0])) + 1
            q.append(now)
            return True, 0


limiter = RateLimiter()


def rate_limited(name, limit, window):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            if config.RATE_LIMIT_ENABLED and not app.testing:
                ok, retry = limiter.allow((name, request.remote_addr), limit, window)
                if not ok:
                    resp = jsonify(error="Too many requests. Please slow down.", retry_after=retry)
                    resp.status_code = 429
                    resp.headers["Retry-After"] = str(retry)
                    return resp
            return fn(*a, **kw)
        return wrapper
    return deco


# --------------------------------------------------------------------------- headers
@app.after_request
def security_headers(resp):
    h = resp.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    h.setdefault("Content-Security-Policy",
                 "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                 "script-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; "
                 "form-action 'self'; frame-ancestors 'none'")
    if request.is_secure:
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.path.startswith("/api/"):
        h["Cache-Control"] = "no-store"
    elif resp.mimetype == "text/html":
        h["Vary"] = "Cookie, Accept-Language"
    return resp


# --------------------------------------------------------------------------- pages
def page(template, **ctx):
    return render_template(template, model_ready=get_bundle() is not None, **ctx)


@app.get("/")
def home():
    return page("home.html", active="home", stats=headline_stats())


@app.get("/analyzer")
def analyzer():
    return page("analyzer.html", active="analyzer")


@app.get("/performance")
def performance():
    return page("performance.html", active="performance")


@app.get("/technology")
def technology():
    return page("technology.html", active="technology")


@app.get("/developers")
def developers():
    return page("developers.html", active="developers")


@app.get("/about")
def about():
    return page("about.html", active="about")


@app.get("/contact")
def contact():
    return page("contact.html", active="contact")


@app.get("/privacy")
def privacy():
    return page("privacy.html", active="")


@app.get("/terms")
def terms():
    return page("terms.html", active="")


@app.get("/robots.txt")
def robots():
    base = config.BRAND["site_url"] or request.url_root.rstrip("/")
    return Response(f"User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: {base}/sitemap.xml\n", mimetype="text/plain")


@app.get("/sitemap.xml")
def sitemap():
    base = config.BRAND["site_url"] or request.url_root.rstrip("/")
    urls = "".join(f"<url><loc>{base}{path}</loc></url>" for _, path in PAGES)
    return Response('<?xml version="1.0" encoding="UTF-8"?>'
                    f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>',
                    mimetype="application/xml")


@app.get("/health")
def health():
    return jsonify(status="ok", model_ready=get_bundle() is not None)


# --------------------------------------------------------------------------- API
@app.get("/api/model-info")
def model_info():
    info = read_metrics()
    if info is None:
        return jsonify(error="Model not available."), 503
    return jsonify(info)


@app.post("/api/predict")
@rate_limited("predict", 120, 60)
def predict():
    bundle = get_bundle()
    if bundle is None:
        return jsonify(error="Model not available."), 503
    payload = request.get_json(silent=True)
    try:
        values, imputed = parse_features(payload.get("features") if isinstance(payload, dict) else None)
    except InputError as exc:
        return jsonify(error=str(exc)), 400
    X = pd.DataFrame([values], columns=bundle["features"])
    p = float(bundle["pipeline"].predict_proba(X)[0][1])
    return jsonify(**result_dict(p), threshold=THRESHOLD, imputed=imputed, explanation=explain(bundle, values, p))


@app.post("/api/predict/batch")
@rate_limited("batch", 30, 60)
def predict_batch():
    bundle = get_bundle()
    if bundle is None:
        return jsonify(error="Model not available."), 503
    payload = request.get_json(silent=True)
    rows = payload.get("rows") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        return jsonify(error='Send JSON like {"rows": [{"id": "A1", "features": {...}}, ...]}'), 400
    if len(rows) > config.MAX_BATCH_ROWS:
        return jsonify(error=f"A batch can contain at most {config.MAX_BATCH_ROWS} rows."), 400

    results, valid_idx, valid_vals = [], [], []
    for i, row in enumerate(rows):
        rid = row.get("id") if isinstance(row, dict) else None
        rid = str(rid)[:64] if rid not in (None, "") else None
        entry = {"index": i, "id": rid}
        try:
            values, imputed = parse_features(row.get("features") if isinstance(row, dict) else None)
        except InputError as exc:
            entry.update(status="error", error=str(exc))
        else:
            entry.update(status="ok", imputed=imputed)
            valid_idx.append(i)
            valid_vals.append(values)
        results.append(entry)

    if valid_vals:
        probs = bundle["pipeline"].predict_proba(pd.DataFrame(valid_vals, columns=bundle["features"]))[:, 1]
        for i, p in zip(valid_idx, probs):
            results[i].update(result_dict(float(p)))

    ok = [r for r in results if r["status"] == "ok"]
    summary = {"rows": len(results), "ok": len(ok), "errors": len(results) - len(ok),
               "malignant": sum(r["label"] == "malignant" for r in ok),
               "benign": sum(r["label"] == "benign" for r in ok),
               "uncertain": sum(r["confidence"] == "uncertain" for r in ok)}
    return jsonify(summary=summary, results=results, threshold=THRESHOLD)


EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
TOPICS = {"product", "integration", "partnership", "other"}


def _notify(entry):
    smtp = config.SMTP
    if not (smtp["host"] and config.BRAND["email"]):
        return
    try:
        msg = EmailMessage()
        msg["Subject"] = f"[{config.BRAND['name']}] New {entry['topic']} message from {entry['name']}"
        msg["From"] = smtp["user"] or config.BRAND["email"]
        msg["To"] = config.BRAND["email"]
        msg["Reply-To"] = entry["email"]
        msg.set_content(f"Name: {entry['name']}\nEmail: {entry['email']}\nOrganization: {entry['organization']}\n"
                        f"Topic: {entry['topic']}\n\n{entry['message']}\n")
        with smtplib.SMTP(smtp["host"], smtp["port"], timeout=10) as s:
            s.starttls()
            if smtp["user"]:
                s.login(smtp["user"], smtp["password"])
            s.send_message(msg)
    except Exception:  # noqa: BLE001 - never fail the request because e-mail failed
        log.exception("Could not send contact notification")


def _notify_webhook(entry):
    """POST the message to a webhook (Discord / Slack / generic JSON). Runs in a background thread."""
    url = config.CONTACT_WEBHOOK_URL
    if not url or urlparse(url).scheme not in ("http", "https"):
        return
    text = (f"New {entry['topic']} message from {entry['name']} <{entry['email']}>"
            f"{' (' + entry['organization'] + ')' if entry['organization'] else ''}\n\n{entry['message']}")
    host = urlparse(url).netloc.lower()
    if "discord" in host:
        payload = {"content": text[:1900]}
    elif "slack" in host:
        payload = {"text": text}
    else:
        payload = dict(entry, text=text)
    try:
        req = Request(url, data=json.dumps(payload).encode("utf-8"),
                      headers={"Content-Type": "application/json", "User-Agent": "contact-notifier/1.0"})
        with urlopen(req, timeout=10):
            pass
    except Exception:  # noqa: BLE001 - never fail the request because the notification failed
        log.exception("Could not send contact webhook")


_contact_lock = threading.Lock()


@app.post("/api/contact")
@rate_limited("contact", 5, 3600)
def contact_submit():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="Invalid request."), 400
    if str(data.get("website", "")).strip():          # honeypot field, hidden from people
        return jsonify(ok=True)
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip()
    org = str(data.get("organization", "")).strip()
    topic = str(data.get("topic", "other")).strip()
    message = str(data.get("message", "")).strip()
    errors = {}
    if not 2 <= len(name) <= 100:
        errors["name"] = "invalid"
    if not EMAIL_RE.match(email):
        errors["email"] = "invalid"
    if len(org) > 120:
        errors["organization"] = "invalid"
    if topic not in TOPICS:
        errors["topic"] = "invalid"
    if not 10 <= len(message) <= 4000:
        errors["message"] = "invalid"
    if errors:
        return jsonify(error="Please check the highlighted fields.", fields=errors), 400
    entry = {"received": datetime.now(timezone.utc).isoformat(timespec="seconds"), "name": name, "email": email,
             "organization": org, "topic": topic, "message": message}
    INSTANCE.mkdir(exist_ok=True)
    with _contact_lock, (INSTANCE / "contact_messages.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    threading.Thread(target=_notify, args=(entry,), daemon=True).start()
    threading.Thread(target=_notify_webhook, args=(entry,), daemon=True).start()
    return jsonify(ok=True)


# --------------------------------------------------------------------------- errors
@app.errorhandler(404)
def not_found(_):
    if request.path.startswith("/api/"):
        return jsonify(error="Not found"), 404
    return page("404.html", active=""), 404


@app.errorhandler(405)
def not_allowed(_):
    return jsonify(error="Method not allowed"), 405


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="Request too large"), 413


@app.errorhandler(500)
def server_error(_):
    if request.path.startswith("/api/"):
        return jsonify(error="Internal server error"), 500
    return page("404.html", active="", server_error=True), 500


try:                       # load the model at start-up so the first request is fast
    get_bundle()
except Exception:  # noqa: BLE001
    log.exception("Could not load the model at start-up")

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
