"""
Quick SMTP test — run from project root in WSL:
    source env/bin/activate
    python test_email.py your@email.com
"""
import sys
import smtplib
import ssl

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("WARNING: python-dotenv not installed — reading from shell env only")

import os

TO = sys.argv[1] if len(sys.argv) > 1 else None
if not TO:
    print("Usage: python test_email.py recipient@example.com")
    sys.exit(1)

ENABLED = os.getenv("SMTP_ENABLED", "").strip().lower()
HOST    = os.getenv("SMTP_HOST", "").strip()
PORT    = int(os.getenv("SMTP_PORT", "587").strip())
USER    = os.getenv("SMTP_USER", "").strip()
PASS    = os.getenv("SMTP_PASS", "").strip()
FROM    = os.getenv("SMTP_FROM", "").strip() or USER

print(f"SMTP_ENABLED : {ENABLED!r}  → {'OK' if ENABLED in ('true','1','yes') else 'DISABLED — check .env'}")
print(f"SMTP_HOST    : {HOST!r}")
print(f"SMTP_PORT    : {PORT}")
print(f"SMTP_USER    : {USER!r}")
print(f"SMTP_PASS    : {'*' * len(PASS) if PASS else 'EMPTY'}")
print(f"SMTP_FROM    : {FROM!r}")
print(f"Sending to   : {TO!r}")
print()

if not HOST or not USER or not PASS:
    print("ERROR: SMTP_HOST / SMTP_USER / SMTP_PASS are missing. Fill in .env and retry.")
    sys.exit(1)

try:
    if PORT == 465:
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(HOST, PORT, context=ctx) as s:
            s.login(USER, PASS)
            s.sendmail(FROM, [TO], f"Subject: ADA email test\r\nFrom: {FROM}\r\nTo: {TO}\r\n\r\nTest OK")
    else:
        with smtplib.SMTP(HOST, PORT) as s:
            s.ehlo()
            s.starttls(context=ssl.create_default_context())
            s.ehlo()
            s.login(USER, PASS)
            s.sendmail(FROM, [TO], f"Subject: ADA email test\r\nFrom: {FROM}\r\nTo: {TO}\r\n\r\nTest OK")
    print("SUCCESS — test email sent. Check your inbox.")
except Exception as e:
    print(f"FAILED: {e}")
    print()
    print("Common fixes:")
    print("  Gmail: use an App Password (not your regular password)")
    print("  Gmail: App Password must have no spaces when stored in .env")
    print("  Gmail: 2-Step Verification must be ON for the account")
