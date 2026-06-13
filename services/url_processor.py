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
                    if (!el || el === document.body) return null;
                    const tag = (el.tagName || '').toLowerCase();

                    // ID is always the most specific selector
                    if (el.id) return `${tag}#${el.id}`;

                    // Links: prefer the href path
                    if (tag === 'a') {
                      const href = el.getAttribute('href') || '';
                      if (href && href !== '#' && href !== '/') return `a[href="${href.slice(0, 60)}"]`;
                      const text = (el.textContent || '').trim().slice(0, 30);
                      if (text) return `a("${text}")`;
                    }

                    // Inputs: type + name/placeholder
                    if (tag === 'input') {
                      const type = el.type ? `[type="${el.type}"]` : '';
                      const name = el.name ? `[name="${el.name}"]` : '';
                      const ph = (!name && el.placeholder) ? `[placeholder="${el.placeholder.slice(0,30)}"]` : '';
                      return `input${type}${name}${ph}`;
                    }

                    // Buttons: visible text
                    if (tag === 'button') {
                      const text = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30);
                      return text ? `button("${text}")` : 'button';
                    }

                    // Select / textarea: name or placeholder
                    if (tag === 'select' || tag === 'textarea') {
                      const name = el.name ? `[name="${el.name}"]` : '';
                      return `${tag}${name}`;
                    }

                    // aria-label / title as fallback descriptor
                    const aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
                    if (aria) return `${tag}[aria-label="${aria.slice(0, 40)}"]`;

                    // Class-based fallback (first 2 classes only)
                    const cls = (typeof el.className === 'string' && el.className.trim())
                      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
                      : '';

                    return `${tag}${cls}` || tag;
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

            # Extract structured color data from axe's "any" checks
            axe_data = {}
            for check in (node.get("any") or []):
                if check.get("id") in ("color-contrast", "color-contrast-enhanced"):
                    axe_data = check.get("data") or {}
                    break

            ratio = _extract_ratio_info(failure_summary)
            # Prefer axe's structured contrastRatio over regex extraction
            if axe_data.get("contrastRatio") is not None:
                try:
                    ratio["current"] = round(float(axe_data["contrastRatio"]), 2)
                except (TypeError, ValueError):
                    pass

            if ratio["current"] is not None:
                ratio_values.append(ratio["current"])

            fg_color = axe_data.get("fgColor") or ""
            bg_color = axe_data.get("bgColor") or ""

            samples.append({
                "target": target_text or "Unknown target",
                "summary": _extract_fix_text(failure_summary),
                "html": (node.get("html") or "")[:220],
                "ratio": ratio,
                "fgColor": fg_color,
                "bgColor": bg_color,
                "fontSize": axe_data.get("fontSize") or "",
                "fontWeight": axe_data.get("fontWeight") or "",
            })

            key = target_text or "Unknown target"
            if key not in grouped:
                grouped[key] = {
                    "target": key,
                    "count": 0,
                    "summary": _extract_fix_text(failure_summary),
                    "ratio": ratio,
                    "fgColor": fg_color,
                    "bgColor": bg_color,
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


def run_page_structure_assisted_test(url: str) -> dict:
    """
    Audit page structure: heading hierarchy and landmark regions.
    Uses Playwright to extract the real DOM state, plus axe for violations.
    """
    url = (url or "").strip()
    if not url:
        raise ValueError("URL is required")

    from playwright.sync_api import sync_playwright

    headings = []
    landmarks = []
    page_title = ""
    errors = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1366, "height": 768})
            page = context.new_page()
            try:
                page.goto(url, timeout=45000, wait_until="domcontentloaded")
                page.wait_for_timeout(800)
                page_title = page.title() or ""

                headings = page.evaluate("""() => {
                    const hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
                    return hs.map(h => ({
                        level: parseInt(h.tagName[1], 10),
                        text: (h.innerText || h.textContent || '').trim().slice(0, 120),
                        id: h.id || '',
                        visible: h.offsetParent !== null || h.offsetWidth > 0 || h.offsetHeight > 0,
                    }));
                }""")

                landmarks = page.evaluate("""() => {
                    const ROLE_TO_LABEL = {
                        main: 'main', navigation: 'navigation', banner: 'banner',
                        contentinfo: 'contentinfo', complementary: 'complementary',
                        search: 'search', form: 'form', region: 'region',
                    };
                    const IMPLICIT = {
                        main: 'main', nav: 'navigation', header: 'banner',
                        footer: 'contentinfo', aside: 'complementary',
                        form: 'form', section: 'region',
                    };
                    const elems = Array.from(document.querySelectorAll(
                        'main,[role="main"],nav,[role="navigation"],header,[role="banner"],' +
                        'footer,[role="contentinfo"],aside,[role="complementary"],' +
                        '[role="search"],[role="form"],[role="region"],section[aria-label],section[aria-labelledby]'
                    ));
                    return elems.map(el => {
                        const explicitRole = (el.getAttribute('role') || '').toLowerCase();
                        const tagRole = IMPLICIT[el.tagName.toLowerCase()] || '';
                        const role = explicitRole || tagRole || 'region';
                        const ariaLabel = el.getAttribute('aria-label') || '';
                        const ariaLabelledby = el.getAttribute('aria-labelledby') || '';
                        return {
                            role: ROLE_TO_LABEL[role] || role,
                            tagName: el.tagName.toLowerCase(),
                            label: ariaLabel,
                            labelledby: ariaLabelledby,
                            visible: el.offsetParent !== null,
                        };
                    });
                }""")
            finally:
                context.close()
                browser.close()
    except Exception as exc:
        errors.append(str(exc))

    # ── Analyze heading hierarchy ─────────────────────────────────────────────
    visible_headings = [h for h in headings if h.get("visible", True)]
    heading_issues = []

    h1_count = sum(1 for h in visible_headings if h["level"] == 1)
    if h1_count == 0:
        heading_issues.append({
            "type": "no_h1",
            "severity": "error",
            "message": "Page has no H1 heading",
            "detail": "Every page should have exactly one H1 that describes the page content.",
        })
    elif h1_count > 1:
        heading_issues.append({
            "type": "multiple_h1",
            "severity": "warning",
            "message": f"Page has {h1_count} H1 headings",
            "detail": "Most pages should have exactly one H1 heading.",
        })

    prev_level = 0
    for h in visible_headings:
        if prev_level > 0 and h["level"] > prev_level + 1:
            heading_issues.append({
                "type": "skipped_level",
                "severity": "error",
                "message": f"Heading level skips from H{prev_level} to H{h['level']}",
                "detail": f'Near: "{h["text"][:60]}"',
            })
        prev_level = h["level"]

    # ── Analyze landmark regions ──────────────────────────────────────────────
    visible_landmarks = [l for l in landmarks if l.get("visible", True)]
    landmark_issues = []

    roles_present = {l["role"] for l in visible_landmarks}
    if "main" not in roles_present:
        landmark_issues.append({
            "type": "no_main",
            "severity": "error",
            "message": "Page has no <main> landmark",
            "detail": "Every page should have a <main> landmark to identify the primary content area.",
        })

    nav_count = sum(1 for l in visible_landmarks if l["role"] == "navigation")
    unlabelled_navs = [l for l in visible_landmarks if l["role"] == "navigation" and not l.get("label") and not l.get("labelledby")]
    if nav_count > 1 and len(unlabelled_navs) > 1:
        landmark_issues.append({
            "type": "unlabelled_navs",
            "severity": "warning",
            "message": f"{nav_count} navigation landmarks found but none are labelled",
            "detail": "When a page has multiple <nav> elements, each should have a unique aria-label.",
        })

    # ── Build checks ──────────────────────────────────────────────────────────
    all_issues = heading_issues + landmark_issues
    error_issues = [i for i in all_issues if i.get("severity") == "error"]
    passed = len(error_issues) == 0 and not errors

    checks = [
        {
            "id": "heading-hierarchy",
            "label": "Heading hierarchy is logical",
            "passed": len([i for i in heading_issues if i.get("severity") == "error"]) == 0,
            "details": f"{len(visible_headings)} heading(s) found, {len(heading_issues)} issue(s)" if visible_headings else "No headings found",
        },
        {
            "id": "landmark-regions",
            "label": "Key landmark regions present",
            "passed": "main" in roles_present,
            "details": f"{len(set(l['role'] for l in visible_landmarks))} unique landmark type(s) detected",
        },
    ]

    return {
        "url": url,
        "module": "page-structure",
        "ok": not bool(errors),
        "passed": passed,
        "title": page_title,
        "checks": checks,
        "failedChecks": [c for c in checks if not c["passed"]],
        "headings": visible_headings[:100],
        "headingIssues": heading_issues,
        "landmarks": visible_landmarks[:50],
        "landmarkIssues": landmark_issues,
        "errors": errors,
        "summary": (
            "Page structure checks passed."
            if passed
            else f"Found {len(all_issues)} structural issue(s)."
        ),
    }
