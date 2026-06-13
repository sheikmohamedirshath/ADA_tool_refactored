"""
Weekly Digest Service — aggregates crawl data from the past 7 days,
stores the digest in DigestHistory, and optionally sends an email.
"""
import logging
import smtplib
import ssl
from datetime import date, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import Config
from services import db

logger = logging.getLogger(__name__)


def generate_weekly_digest(send_email: bool = True) -> dict | None:
    """
    Build a weekly digest for all crawled sites and persist it.
    Returns the digest dict, or None on failure.
    """
    if not db.is_ready():
        logger.warning("Digest: DB not ready, skipping.")
        return None

    week_end = date.today()
    week_start = week_end - timedelta(days=6)

    rows = db.get_weekly_crawl_data(week_start, week_end)
    if not rows:
        logger.info("Digest: no completed crawls in %s–%s", week_start, week_end)
        return None

    sites = []
    for row in rows:
        score_trend = _score_trend(row["root_url"])
        sites.append({
            "root_url": row["root_url"],
            "crawl_count": row["crawl_count"],
            "avg_score": row["site_score"],
            "avg_pass_rate": row["avg_pass_rate"],
            "total_violations": row["total_violations"],
            "score_trend": score_trend,
            "last_run": row["last_run"],
        })

    digest_data = {
        "week_start": str(week_start),
        "week_end": str(week_end),
        "total_sites": len(sites),
        "total_crawls": sum(s["crawl_count"] for s in sites),
        "sites": sites,
    }

    digest_id = db.create_digest(week_start, week_end, digest_data)

    if send_email and Config.SMTP_ENABLED and Config.SMTP_HOST:
        recipient = (Config.DIGEST_EMAIL or Config.SMTP_FROM or "").strip()
        if recipient:
            sent = _send_digest_email(recipient, digest_data)
            if sent and digest_id:
                from datetime import datetime, timezone
                db.update_digest_sent(digest_id, datetime.now(timezone.utc), recipient)

    return digest_data


def _score_trend(root_url: str) -> str:
    timeline = db.get_crawl_score_timeline(root_url, limit=5)
    if len(timeline) < 2:
        return "stable"
    scores = [t["site_score"] for t in timeline if t["site_score"] is not None]
    if len(scores) < 2:
        return "stable"
    delta = scores[-1] - scores[0]
    if delta > 3:
        return "improving"
    if delta < -3:
        return "declining"
    return "stable"


def _send_digest_email(recipient: str, digest: dict) -> bool:
    try:
        sites = digest.get("sites", [])
        week_start = digest.get("week_start", "")
        week_end = digest.get("week_end", "")

        rows_html = ""
        for s in sites:
            trend_icon = {"improving": "↑", "declining": "↓"}.get(s.get("score_trend", ""), "→")
            trend_color = {"improving": "#6BA368", "declining": "#E76F51"}.get(s.get("score_trend", ""), "#9CA3AF")
            score = s.get("avg_score") or "—"
            violations = s.get("total_violations") or "—"
            crawls = s.get("crawl_count", 0)
            rows_html += f"""
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px">{s['root_url']}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center">{crawls}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center;font-weight:bold">{score}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center;color:{trend_color};font-weight:bold">{trend_icon}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center">{violations}</td>
            </tr>"""

        html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#1f2937">
  <div style="background:#0F766E;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
    <h1 style="margin:0;font-size:20px">Weekly Accessibility Digest</h1>
    <p style="margin:4px 0 0;opacity:.8;font-size:13px">{week_start} – {week_end}</p>
  </div>
  <div style="background:#f9fafb;padding:16px 24px;border:1px solid #e5e7eb;border-top:none">
    <span style="font-size:13px;color:#6b7280">{digest['total_sites']} site(s) &mdash; {digest['total_crawls']} crawl(s) this week</span>
  </div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-top:none">
    <thead>
      <tr style="background:#f3f4f6">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase">Site</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase">Crawls</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase">Score</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase">Trend</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase">Violations</th>
      </tr>
    </thead>
    <tbody>{rows_html}</tbody>
  </table>
  <p style="margin-top:24px;color:#9ca3af;font-size:11px">
    ADA Accessibility Monitor &mdash; Weekly digest
  </p>
</body></html>"""

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[ADA Digest] Weekly accessibility summary ({week_start} – {week_end})"
        msg["From"] = Config.SMTP_FROM
        msg["To"] = recipient
        msg.attach(MIMEText(html, "html", "utf-8"))

        ctx = ssl.create_default_context()
        with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT) as s:
            s.ehlo()
            s.starttls(context=ctx)
            if Config.SMTP_USER and Config.SMTP_PASS:
                s.login(Config.SMTP_USER, Config.SMTP_PASS)
            s.sendmail(Config.SMTP_FROM, [recipient], msg.as_string())

        logger.info("Digest email sent to %s", recipient)
        return True
    except Exception:
        logger.exception("Failed to send digest email to %s", recipient)
        return False
