# Spring Boot Backend Status

This `backend/` module is legacy/reference code in the current repository state.

The active application runtime uses:

- React/Vite frontend in `src/`
- Flask API in `app.py`
- Python Playwright + axe scan runner in `services/` and `scripts/`

Keep this module only if you still need the old Java implementation for comparison or future migration work. If the project direction stays Flask-first, this folder can eventually be archived or moved out of the main runtime path.
