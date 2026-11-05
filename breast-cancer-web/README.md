# CytoScan AI

A complete web product for AI-assisted cytology analysis: a multi-page, bilingual (English / Arabic) website
with a single-sample analyzer, CSV batch analysis, printable reports, a model-performance dashboard, API
documentation with a live console, and a working contact form. Predictions come from the best model of the
classification project, a neural network (`MLPClassifier`) trained on the Breast Cancer Wisconsin (Original) dataset.

## Quick start

```bash
python -m venv venv
venv\Scripts\activate                 # Windows   |   source venv/bin/activate  (macOS/Linux)
python -m pip install -r requirements.txt

# put breast-cancer-wisconsin.data inside ./data  (if it is missing, the script downloads it from UCI)
python train_model.py                 # trains the ANN -> model/model.joblib, model/metrics.json
python app.py                         # http://127.0.0.1:5000
```

`train_model.py` prints the test metrics next to the project notebook's values (accuracy 0.9712, recall 0.9583,
ROC-AUC 0.9961) and computes the feature importance shown on the performance page.

| Command | What it does |
|---|---|
| `python train_model.py` | Uses the best hyperparameters found in the project |
| `python train_model.py --tune` | Re-runs the 5-fold GridSearchCV for the ANN first |
| `python train_model.py --full` | After evaluating, refits the model on **all** data for deployment |
| `python train_model.py --data path/or/url` | Uses a custom data file |

## Pages

| Route | Content |
|---|---|
| `/` | Landing page with a live demo card, key figures, capabilities, security, FAQ |
| `/analyzer` | Single sample (sliders, examples, gauge, contributing factors, history, print report, copy summary) and **Batch (CSV)** |
| `/performance` | Metrics of the deployed model, five-model comparison, confusion matrices, cross-validation stability, feature importance |
| `/technology` | Pipeline, data, preprocessing, model, validation, explainability, intended use |
| `/developers` | API reference, code samples (cURL, Python, JavaScript), live "Try it" console |
| `/about`, `/contact` | Company pages; the contact form stores messages in `instance/contact_messages.jsonl` |
| `/privacy`, `/terms` | Legal pages (templates; have them reviewed for your jurisdiction before launch) |
| `/robots.txt`, `/sitemap.xml`, `/health` | SEO and status |

## Batch CSV format

One row per sample. Columns: `id` (optional) plus the nine measurements
(`clump_thickness, uniformity_cell_size, uniformity_cell_shape, marginal_adhesion, single_epithelial_cell_size,
bare_nuclei, bland_chromatin, normal_nucleoli, mitoses`), each a whole number from 1 to 10.
`bare_nuclei` may be empty or `?`; it is imputed with the training median. Comma, semicolon or tab delimiters are
detected automatically. A template can be downloaded from the batch tab. Results can be filtered, sorted and exported.

## Branding and configuration

Everything is configured with environment variables (see `config.py`), no template edits needed:

| Variable | Purpose | Default |
|---|---|---|
| `BRAND_NAME` | Product name shown in the header, footer, titles | `CytoScan AI` |
| `COMPANY_NAME` | Legal name used in the footer and terms | `BRAND_NAME` |
| `CONTACT_EMAIL` | Shown on the contact page; receives notifications | empty |
| `SITE_URL` | Public URL for canonical links and the sitemap | request URL |
| `CONTACT_WEBHOOK_URL` | Discord / Slack / generic HTTPS webhook that receives every contact message (works on free hosts) | empty |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Optional e-mail notification (needs a host that allows SMTP ports) | empty |
| `MAX_BATCH_ROWS` | Maximum rows per batch request | `1000` |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy so client IPs and HTTPS are detected | `0` |
| `RATE_LIMIT_DISABLED` | Set to `1` to turn rate limiting off | `0` |

All site text lives in `translations/en.json` and `translations/ar.json`. Colors and typography are CSS variables at
the top of `static/css/style.css`. The logo mark is inline SVG in `templates/base.html`.

## API

`POST /api/predict`, `POST /api/predict/batch`, `GET /api/model-info`, `GET /health`, `POST /api/contact`.
Full reference with examples: `/developers`. Public endpoints need no key and are rate limited per IP
(120 predictions/min, 30 batches/min, 5 contact messages/hour).

`confidence` is a rough band (`high`, `moderate`, `uncertain`), not a calibrated clinical confidence.
`influence` is each measurement's signed share of the total change in the model's log-odds when it is replaced by
its training median (positive = pushes towards malignant).

## Structure

```
app.py                  Flask app: pages, API, i18n, rate limiting, security headers
config.py               Branding and settings from environment variables
train_model.py          Preprocessing, ANN training, evaluation, permutation importance, saving
translations/           en.json, ar.json (all site text)
templates/              base.html, _macros.html and one template per page
static/css, static/js   Design system and page scripts
static/data/            Results of the five models (from the project notebook)
static/vendor, fonts    Chart.js, Inter and Cairo (no external requests)
tests/test_app.py       38 tests (pages in both languages, API, batch, contact, rate limiting)
data/, model/, instance/   dataset, trained model, contact messages
```

## Tests

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q tests          # trains a tiny model on synthetic data; no dataset needed
```

## Deploying (Render)

1. Push the project to a GitHub repository (the dataset file in `data/` must be included; the model is built on the server).
2. On Render: **New > Web Service**, connect the repository and use:

| Setting | Value |
|---|---|
| Language | Python 3 |
| Build command | `pip install -r requirements.txt && python train_model.py` |
| Start command | `gunicorn app:app --workers 1 --threads 4 --timeout 60` |
| Health check path | `/health` |

3. Environment variables: `TRUST_PROXY=1`, `BRAND_NAME`, `COMPANY_NAME`, `CONTACT_EMAIL`, `SITE_URL` (your final URL) and, for contact notifications, `CONTACT_WEBHOOK_URL`.
4. The Python version comes from `.python-version` (3.12). Every push to the linked branch redeploys automatically.

Notes for Render's free instance: it sleeps after 15 minutes without traffic (the next visit takes up to a minute),
its filesystem is ephemeral (messages in `instance/` are lost on restart, so use `CONTACT_WEBHOOK_URL`),
and outbound SMTP ports are blocked. A paid instance removes these limits. Any other Python host works too
(`Procfile` included); keep the same scikit-learn version for training and serving and serve over HTTPS.

## Notes

- Trained on 691 samples from a single dataset; validate on your own data before relying on it.
- Inputs are expert-scored cytological features, not images.
- The decision threshold is 0.5; a clinical deployment would tune it towards higher recall.
