"""
Unit tests for backend/services/digest_service.py.
Tests generate_weekly_digest aggregation and _score_trend classification.
"""
import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("MSSQL_CONN_STR", "")
os.environ.setdefault("ANTHROPIC_API_KEY", "")


WEEKLY_ROWS = [
    {
        "root_url": "https://site-a.com",
        "crawl_count": 3,
        "site_score": 85,
        "avg_pass_rate": 88,
        "total_violations": 12,
        "last_run": "2026-06-10",
    },
    {
        "root_url": "https://site-b.com",
        "crawl_count": 1,
        "site_score": 72,
        "avg_pass_rate": 75,
        "total_violations": 25,
        "last_run": "2026-06-09",
    },
]


def _make_db(weekly_rows=None, timeline=None) -> MagicMock:
    m = MagicMock()
    m.is_ready.return_value = True
    m.get_weekly_crawl_data.return_value = weekly_rows if weekly_rows is not None else WEEKLY_ROWS
    m.get_crawl_score_timeline.return_value = timeline or []
    m.create_digest.return_value = 1
    m.update_digest_sent.return_value = None
    return m


def _run(db_mock, send_email=False, smtp_enabled=False):
    from backend.services import digest_service
    with patch("backend.services.digest_service.db", db_mock), \
         patch("backend.services.digest_service.Config") as cfg:
        cfg.SMTP_ENABLED = smtp_enabled
        cfg.SMTP_HOST = "smtp.example.com" if smtp_enabled else ""
        cfg.SMTP_FROM = "from@example.com"
        cfg.SMTP_PORT = 587
        cfg.SMTP_USER = ""
        cfg.SMTP_PASS = ""
        cfg.DIGEST_EMAIL = "digest@example.com" if smtp_enabled else ""
        return digest_service.generate_weekly_digest(send_email=send_email)


@pytest.mark.unit
class TestGenerateWeeklyDigest:

    def test_returns_none_when_db_not_ready(self):
        m = _make_db()
        m.is_ready.return_value = False
        assert _run(m) is None

    def test_returns_none_when_no_weekly_data(self):
        m = _make_db(weekly_rows=[])
        assert _run(m) is None

    def test_returns_dict_on_success(self):
        m = _make_db()
        result = _run(m)
        assert result is not None
        assert isinstance(result, dict)

    def test_result_has_required_keys(self):
        m = _make_db()
        result = _run(m)
        for key in ("week_start", "week_end", "total_sites", "total_crawls", "sites"):
            assert key in result, f"Missing key: {key}"

    def test_total_sites_matches_row_count(self):
        m = _make_db()
        assert _run(m)["total_sites"] == 2

    def test_total_crawls_is_sum_of_crawl_counts(self):
        m = _make_db()
        assert _run(m)["total_crawls"] == 4  # 3 + 1

    def test_week_start_is_before_week_end(self):
        m = _make_db()
        result = _run(m)
        assert result["week_start"] < result["week_end"]

    def test_sites_list_length_matches_rows(self):
        m = _make_db()
        result = _run(m)
        assert len(result["sites"]) == len(WEEKLY_ROWS)

    def test_each_site_has_score_trend(self):
        m = _make_db()
        for site in _run(m)["sites"]:
            assert "score_trend" in site
            assert site["score_trend"] in ("improving", "declining", "stable")

    def test_create_digest_called_once(self):
        m = _make_db()
        _run(m)
        m.create_digest.assert_called_once()

    def test_no_email_when_smtp_disabled(self):
        m = _make_db()
        _run(m, send_email=True, smtp_enabled=False)
        m.update_digest_sent.assert_not_called()

    def test_site_data_preserved_in_sites_list(self):
        m = _make_db()
        result = _run(m)
        urls = {s["root_url"] for s in result["sites"]}
        assert "https://site-a.com" in urls
        assert "https://site-b.com" in urls


@pytest.mark.unit
class TestScoreTrend:

    def _trend(self, timeline, url="https://example.com"):
        from backend.services import digest_service
        db_mock = _make_db(timeline=timeline)
        with patch("backend.services.digest_service.db", db_mock):
            return digest_service._score_trend(url)

    def test_stable_when_empty_timeline(self):
        assert self._trend([]) == "stable"

    def test_stable_when_single_entry(self):
        assert self._trend([{"site_score": 80}]) == "stable"

    def test_stable_when_delta_within_3(self):
        timeline = [{"site_score": 80}, {"site_score": 82}]
        assert self._trend(timeline) == "stable"

    def test_improving_when_last_minus_first_gt_3(self):
        # delta = scores[-1] - scores[0]
        timeline = [{"site_score": 75}, {"site_score": 80}, {"site_score": 85}]
        assert self._trend(timeline) == "improving"

    def test_declining_when_last_minus_first_lt_minus_3(self):
        timeline = [{"site_score": 90}, {"site_score": 85}, {"site_score": 80}]
        assert self._trend(timeline) == "declining"

    def test_stable_when_all_scores_are_none(self):
        timeline = [{"site_score": None}, {"site_score": None}]
        assert self._trend(timeline) == "stable"

    def test_stable_when_only_one_non_none_score(self):
        timeline = [{"site_score": None}, {"site_score": 80}]
        assert self._trend(timeline) == "stable"

    def test_score_trend_uses_url_argument(self):
        db_mock = _make_db(timeline=[])
        from backend.services import digest_service
        with patch("backend.services.digest_service.db", db_mock):
            digest_service._score_trend("https://specific.com")
        call_args = db_mock.get_crawl_score_timeline.call_args
        assert "https://specific.com" in str(call_args)
