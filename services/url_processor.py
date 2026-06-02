"""
URL processing: runs ADA check using axe-playwright-python (Playwright + axe-core)
and returns axe-core JSON for the frontend to show on the ADA Results page.

Execution uses the same Playwright path as scripts/run_ada_check_python.py.
Requires: pip install axe-playwright-python && python -m playwright install chromium
"""
import json
import logging
import re
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
OUTPUT_JSON = PROJECT_ROOT / "output" / "ada_result.json"


def _safe_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def _extract_fix_text(failure_summary: str) -> str:
    """
    Convert axe failureSummary into a short readable fix line.
    Removes generic prefixes like 'Fix any of the following:'.
    """
    text = (failure_summary or "").strip()
    if not text:
        return ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = line.replace("Fix all of the following:", "").replace("Fix any of the following:", "").replace("Fix one of the following:", "").strip()
        if line:
            return line
    return ""


def _extract_ratio_info(failure_summary: str) -> dict:
    """
    Parse ratio details from axe color-contrast failure summary.
    Example source text: "insufficient color contrast of 4.31 ... Expected contrast ratio of 4.5:1"
    """
    text = (failure_summary or "").strip()
    if not text:
        return {"current": None, "required": None, "gap": None}

    current_match = re.search(r"contrast of\s+([0-9]+(?:\.[0-9]+)?)", text, flags=re.IGNORECASE)
    required_match = re.search(r"Expected contrast ratio of\s+([0-9]+(?:\.[0-9]+)?)", text, flags=re.IGNORECASE)

    current = float(current_match.group(1)) if current_match else None
    required = float(required_match.group(1)) if required_match else None
    gap = round((required - current), 2) if current is not None and required is not None else None
    return {"current": current, "required": required, "gap": gap}


def process_url(url: str, include_best_practices: bool = False, write_output: bool = False) -> dict:
    """
    Run ADA check for the given URL using Playwright + axe (axe-playwright-python).
    Returns dict with axeResult (full axe report) and message.
    """
    url = (url or "").strip()
    if not url:
        raise ValueError("URL is required")

    from scripts.run_ada_check_python import run_axe_playwright

    try:
        axe_result = run_axe_playwright(url, include_best_practices=include_best_practices)
    except Exception as e:
        logger.exception("Playwright scan failed for %s", url)
        raise

    if write_output:
        OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
            json.dump(axe_result, f, indent=2)

    return {
        "url": url,
        "message": "ADA check completed",
        "axeResult": axe_result,
        "includeBestPractices": include_best_practices,
        "usedFallback": False,
    }


def run_keyboard_assisted_test(url: str) -> dict:
    """
    Run a lightweight automated keyboard test for a URL.
    Returns pass/fail-style checks and simple evidence.
    """
    url = (url or "").strip()
    if not url:
        raise ValueError("URL is required")

    from playwright.sync_api import sync_playwright

    checks = []
    focus_path = []
    errors = []
    page_title = ""
    focusable_count = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1366, "height": 768})
        page = context.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(800)
            page_title = page.title() or ""

            focusable_count = _safe_int(page.evaluate("""
              () => {
                const nodes = document.querySelectorAll(
                  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                return Array.from(nodes).filter((el) => !el.disabled && el.offsetParent !== null).length;
              }
            """))
            checks.append({
                "id": "focusable-elements-present",
                "label": "Focusable elements detected",
                "passed": focusable_count > 0,
                "details": f"{focusable_count} visible focusable elements found",
            })

            page.keyboard.press("Tab")
            page.wait_for_timeout(120)

            active_exists = bool(page.evaluate("() => !!document.activeElement"))
            checks.append({
                "id": "initial-focus-reachable",
                "label": "Initial keyboard focus is reachable",
                "passed": active_exists,
                "details": "Tab key moved focus to an element" if active_exists else "No focused element after Tab",
            })

            for _ in range(8):
                info = page.evaluate("""
                  () => {
                    const el = document.activeElement;
                    if (!el) return null;
                    const tag = (el.tagName || '').toLowerCase();
                    const id = el.id ? `#${el.id}` : '';
                    const cls = (el.className && typeof el.className === 'string')
                      ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.')
                      : '';
                    return `${tag}${id}${cls}`;
                  }
                """)
                if info:
                    focus_path.append(info)
                page.keyboard.press("Tab")
                page.wait_for_timeout(80)

            unique_focus_count = len(set(focus_path))
            checks.append({
                "id": "tab-navigation-progresses",
                "label": "Tab navigation progresses across elements",
                "passed": unique_focus_count >= 3,
                "details": f"{unique_focus_count} unique focused elements during tab sequence",
            })

            focus_visible = bool(page.evaluate("""
              () => {
                const el = document.activeElement;
                if (!el) return false;
                const s = window.getComputedStyle(el);
                const outlineVisible = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth || '0') > 0;
                const shadowVisible = s.boxShadow && s.boxShadow !== 'none';
                return outlineVisible || shadowVisible;
              }
            """))
            checks.append({
                "id": "focus-indicator-visible",
                "label": "Focused element has a visible indicator",
                "passed": focus_visible,
                "details": "Outline or focus ring detected" if focus_visible else "No clear outline/shadow on focused element",
            })
        except Exception as e:
            errors.append(str(e))
        finally:
            context.close()
            browser.close()

    passed = all(c.get("passed") for c in checks) and len(errors) == 0 and len(checks) > 0
    failed_checks = [c for c in checks if not c.get("passed")]

    return {
        "url": url,
        "module": "keyboard",
        "ok": len(errors) == 0,
        "passed": passed,
        "title": page_title,
        "checks": checks,
        "failedChecks": failed_checks,
        "focusPathSample": focus_path[:8],
        "errors": errors,
        "summary": (
            "Keyboard automated checks passed."
            if passed
            else f"Keyboard automated checks found {len(failed_checks)} issue(s)."
        ),
    }


def run_color_contrast_assisted_test(url: str) -> dict:
    """
    Run automated color contrast checks for a URL using axe rule: color-contrast.
    Returns pass/fail summary and affected element samples.
    """
    url = (url or "").strip()
    if not url:
        raise ValueError("URL is required")

    from scripts.run_ada_check_python import run_axe_playwright

    axe_result = run_axe_playwright(url, include_best_practices=False)
    violations = axe_result.get("violations") or []
    contrast_rules = [v for v in violations if (v.get("id") or "").lower() == "color-contrast"]

    total_nodes = 0
    samples = []
    ratio_values = []
    grouped = {}
    for rule in contrast_rules:
        nodes = rule.get("nodes") or []
        total_nodes += len(nodes)
        for node in nodes:
            failure_summary = node.get("failureSummary") or ""
            target = node.get("target") or []
            if isinstance(target, list):
                target_text = " ".join([str(t) for t in target])
            else:
                target_text = str(target)
            ratio = _extract_ratio_info(failure_summary)
            if ratio["current"] is not None:
                ratio_values.append(ratio["current"])
            samples.append({
                "target": target_text or "Unknown target",
                "summary": _extract_fix_text(failure_summary),
                "html": (node.get("html") or "")[:220],
                "ratio": ratio,
            })

            key = target_text or "Unknown target"
            if key not in grouped:
                grouped[key] = {
                    "target": key,
                    "count": 0,
                    "summary": _extract_fix_text(failure_summary),
                    "ratio": ratio,
                }
            grouped[key]["count"] += 1

    grouped_targets = sorted(grouped.values(), key=lambda x: x["count"], reverse=True)
    min_ratio = round(min(ratio_values), 2) if ratio_values else None
    avg_ratio = round(sum(ratio_values) / len(ratio_values), 2) if ratio_values else None

    passed = len(contrast_rules) == 0
    checks = [
        {
            "id": "color-contrast-rule",
            "label": "Axe color contrast rule",
            "passed": passed,
            "details": "No color contrast violations found" if passed else f"{len(contrast_rules)} contrast rule violation(s), {total_nodes} affected element(s)",
        }
    ]

    return {
        "url": url,
        "module": "color-contrast",
        "ok": True,
        "passed": passed,
        "checks": checks,
        "failedChecks": [] if passed else checks,
        "totalContrastRules": len(contrast_rules),
        "totalAffectedElements": total_nodes,
        "affectedSamples": samples[:200],
        "groupedTargets": grouped_targets[:200],
        "ratioOverview": {
            "requiredAA": 4.5,
            "lowestFound": min_ratio,
            "averageFound": avg_ratio,
            "sampleCount": len(ratio_values),
        },
        "summary": (
            "Color contrast automated checks passed."
            if passed
            else f"Color contrast checks found {total_nodes} affected element(s)."
        ),
    }
