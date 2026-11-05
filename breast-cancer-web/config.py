"""Site configuration. Everything can be overridden with environment variables, so the same
code can be branded for a company without touching the templates."""
import os


def _env(name, default=""):
    return os.getenv(name, default).strip()


BRAND = {
    "name": _env("BRAND_NAME", "CytoScan AI"),
    "company": _env("COMPANY_NAME") or _env("BRAND_NAME", "CytoScan AI"),
    "email": _env("CONTACT_EMAIL"),          # shown on the contact page and used for notifications
    "site_url": _env("SITE_URL").rstrip("/"),  # e.g. https://www.example.com (used in sitemap / canonical links)
}

MAX_BATCH_ROWS = int(_env("MAX_BATCH_ROWS", "1000"))
RATE_LIMIT_ENABLED = _env("RATE_LIMIT_DISABLED", "0") != "1"
TRUST_PROXY = _env("TRUST_PROXY", "0") == "1"      # set to 1 behind a reverse proxy (Nginx, Render, ...)

# Optional webhook notification (Discord, Slack or any HTTPS endpoint). Works on hosts that block SMTP ports.
CONTACT_WEBHOOK_URL = _env("CONTACT_WEBHOOK_URL")

# Optional e-mail notification for contact messages (messages are always saved to ./instance as well)
SMTP = {
    "host": _env("SMTP_HOST"), "port": int(_env("SMTP_PORT", "587")),
    "user": _env("SMTP_USER"), "password": _env("SMTP_PASSWORD"),
}
