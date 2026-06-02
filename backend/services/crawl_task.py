"""
RQ task: BFS site crawl with per-page axe accessibility scan.
One Playwright browser is opened for the entire crawl session.
"""
import logging
from collections import deque
from datetime import datetime, timezone

from services import db
from services.crawler import get_root_domain, normalize_url, extract_internal_links

logger = logging.getLogger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _duration(started: str, ended: str) -> float | None:
    try:
        return (
            datetime.fromisoformat(ended.replace("Z", "+00:00"))
            - datetime.fromisoformat(started.replace("Z", "+00:00"))
        ).total_seconds()
    except Exception:
        return None


def crawl_site_task(
    crawl_id: str,
    root_url: str,
    max_depth: int,
    max_pages: int,
) -> dict:
    """
    BFS site crawl: navigate each page with a shared Playwright browser,
    run axe on each page, persist results to DB.
    """
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    from axe_playwright_python.sync_playwright import Axe

    started_at = _utcnow_iso()
    db.update_crawl_job_status(crawl_id, "running", started_at=started_at)
    logger.info(
        "Crawl started | crawl_id=%s url=%s depth=%d pages=%d",
        crawl_id, root_url, max_depth, max_pages,
    )

    root_domain = get_root_domain(root_url)
    queue: deque[tuple[str, str | None, int]] = deque([(root_url, None, 0)])
    visited: set[str] = {normalize_url(root_url)}

    total_scanned = 0
    total_failed = 0
    axe = Axe()

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                ignore_https_errors=True,
            )
            pw_page = context.new_page()

            while queue and (total_scanned + total_failed) < max_pages:
                url, parent_url, depth = queue.popleft()
                norm_url = normalize_url(url)

                page_id = db.save_crawl_page(
                    crawl_id, url, norm_url, parent_url, depth, status="running"
                )
                scanned_at = _utcnow_iso()

                try:
                    try:
                        pw_page.goto(url, wait_until="networkidle", timeout=60000)
                    except PWTimeout:
                        pass  # proceed with what loaded

                    # Discover child links on the already-loaded page
                    if depth < max_depth:
                        for link in extract_internal_links(pw_page, root_url, root_domain):
                            n = normalize_url(link)
                            if n not in visited and len(visited) < max_pages * 3:
                                visited.add(n)
                                queue.append((link, url, depth + 1))

                    # Run axe accessibility scan
                    try:
                        results = axe.run(
                            pw_page,
                            options={"runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa"]}},
                        )
                    except TypeError:
                        results = axe.run(pw_page)

                    axe_data = (
                        results.response
                        if hasattr(results, "response") and results.response
                        else {}
                    )
                    vcount = len(axe_data.get("violations") or [])
                    pcount = len(axe_data.get("passes") or [])
                    total_items = vcount + pcount
                    pass_rate = int(pcount / total_items * 100) if total_items else 100

                    scan_result = {
                        "url": url,
                        "message": "ADA check completed",
                        "axeResult": axe_data,
                        "includeBestPractices": False,
                        "usedFallback": False,
                    }
                    history_id = db.save_scan_history(scan_result)

                    db.update_crawl_page(
                        page_id,
                        status="completed",
                        passes=pcount,
                        violations=vcount,
                        pass_rate=pass_rate,
                        scan_history_id=history_id,
                        scanned_at=scanned_at,
                    )
                    total_scanned += 1

                except Exception as exc:
                    logger.warning(
                        "Page scan failed | crawl_id=%s url=%s reason=%s",
                        crawl_id, url, exc,
                    )
                    db.update_crawl_page(
                        page_id,
                        status="failed",
                        failure_reason=str(exc)[:500],
                    )
                    total_failed += 1

                db.update_crawl_job_progress(
                    crawl_id,
                    total_discovered=len(visited),
                    total_scanned=total_scanned,
                    total_failed=total_failed,
                )

            context.close()
            browser.close()

    except Exception as exc:
        failed_at = _utcnow_iso()
        db.update_crawl_job_status(
            crawl_id, "failed",
            ended_at=failed_at,
            failure_reason=str(exc)[:1000],
        )
        logger.error(
            "Crawl failed | crawl_id=%s reason=%s", crawl_id, exc, exc_info=True
        )
        raise

    completed_at = _utcnow_iso()
    duration = _duration(started_at, completed_at)
    db.update_crawl_job_status(
        crawl_id, "completed",
        ended_at=completed_at,
        duration_seconds=duration,
    )
    logger.info(
        "Crawl completed | crawl_id=%s scanned=%d failed=%d duration=%.1fs",
        crawl_id, total_scanned, total_failed, duration or 0,
    )
    return {
        "crawl_id": crawl_id,
        "root_url": root_url,
        "total_discovered": len(visited),
        "total_scanned": total_scanned,
        "total_failed": total_failed,
        "completed_at": completed_at,
    }
