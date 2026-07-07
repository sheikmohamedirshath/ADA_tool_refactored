"""
Integration tests for alerts, digests, and crawl schedule endpoints.

Endpoints covered:
  GET   /api/alerts
  PATCH /api/alerts/<id>/acknowledge
  GET   /api/alerts/unread-count
  GET   /api/digests
  POST  /api/digests/trigger
  GET   /api/crawl-schedules
  POST  /api/crawl-schedules
  PATCH /api/crawl-schedules/<id>
  DELETE /api/crawl-schedules/<id>
  GET   /api/crawl/<id>/summary      (AI summary)
"""
from unittest.mock import patch, MagicMock
import pytest

from tests.conftest import auth_headers

FAKE_CRAWL_ID = "crawl-abc-001"


# ── /api/alerts ───────────────────────────────────────────────────────────────

class TestAlerts:
    def test_list_returns_items(self, client, db_mock, authed_headers):
        db_mock.get_alerts.return_value = [
            {"id": 1, "alert_type": "score_decrease", "severity": "high", "status": "open"},
        ]
        db_mock.get_unacknowledged_alert_count.return_value = 1
        resp = client.get("/api/alerts", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert len(data["items"]) == 1
        assert data["unread_count"] == 1

    def test_empty_alerts(self, client, db_mock, authed_headers):
        db_mock.get_alerts.return_value = []
        db_mock.get_unacknowledged_alert_count.return_value = 0
        resp = client.get("/api/alerts", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["items"] == []

    def test_db_unavailable_returns_empty(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = False
        resp = client.get("/api/alerts", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["available"] is False
        db_mock.is_ready.return_value = True

    def test_no_auth_401(self, client):
        resp = client.get("/api/alerts")
        assert resp.status_code == 401

    def test_status_filter_passed_to_db(self, client, db_mock, authed_headers):
        db_mock.get_alerts.return_value = []
        db_mock.get_unacknowledged_alert_count.return_value = 0
        client.get("/api/alerts?status=open", headers=authed_headers)
        db_mock.get_alerts.assert_called_with(status="open", limit=50)


class TestAlertsAcknowledge:
    def test_acknowledge_existing_alert(self, client, db_mock, authed_headers):
        db_mock.acknowledge_alert.return_value = True
        resp = client.patch("/api/alerts/1/acknowledge", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_acknowledge_nonexistent_alert(self, client, db_mock, authed_headers):
        db_mock.acknowledge_alert.return_value = False
        resp = client.patch("/api/alerts/9999/acknowledge", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is False

    def test_no_auth_401(self, client):
        resp = client.patch("/api/alerts/1/acknowledge")
        assert resp.status_code == 401

    def test_db_unavailable_503(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = False
        resp = client.patch("/api/alerts/1/acknowledge", headers=authed_headers)
        assert resp.status_code == 503
        db_mock.is_ready.return_value = True


class TestAlertsUnreadCount:
    def test_returns_count(self, client, db_mock, authed_headers):
        db_mock.get_unacknowledged_alert_count.return_value = 3
        resp = client.get("/api/alerts/unread-count", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["count"] == 3

    def test_zero_when_db_unavailable(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = False
        resp = client.get("/api/alerts/unread-count", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["count"] == 0
        db_mock.is_ready.return_value = True

    def test_no_auth_401(self, client):
        resp = client.get("/api/alerts/unread-count")
        assert resp.status_code == 401


# ── /api/digests ──────────────────────────────────────────────────────────────

class TestDigests:
    def test_list_returns_items(self, client, db_mock, authed_headers):
        db_mock.get_digests.return_value = [
            {"id": 1, "period_start": "2026-06-01", "period_end": "2026-06-07"},
        ]
        resp = client.get("/api/digests", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert len(data["items"]) == 1

    def test_db_unavailable_returns_empty(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = False
        resp = client.get("/api/digests", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["available"] is False
        db_mock.is_ready.return_value = True

    def test_no_auth_401(self, client):
        resp = client.get("/api/digests")
        assert resp.status_code == 401


class TestDigestsTrigger:
    def test_trigger_creates_digest(self, client, db_mock, authed_headers):
        fake_digest = {"id": 1, "period_start": "2026-06-07", "period_end": "2026-06-13"}
        with patch("backend.services.digest_service.generate_weekly_digest",
                   return_value=fake_digest):
            resp = client.post("/api/digests/trigger",
                               json={"send_email": False},
                               headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_no_data_returns_error(self, client, db_mock, authed_headers):
        with patch("backend.services.digest_service.generate_weekly_digest",
                   return_value=None):
            resp = client.post("/api/digests/trigger",
                               json={},
                               headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is False

    def test_db_unavailable_503(self, client, db_mock, authed_headers):
        db_mock.is_ready.return_value = False
        resp = client.post("/api/digests/trigger", json={}, headers=authed_headers)
        assert resp.status_code == 503
        db_mock.is_ready.return_value = True

    def test_no_auth_401(self, client):
        resp = client.post("/api/digests/trigger", json={})
        assert resp.status_code == 401


# ── /api/crawl-schedules ──────────────────────────────────────────────────────

class TestCrawlSchedules:
    def test_list_schedules(self, client, db_mock, authed_headers):
        db_mock.get_crawl_schedules.return_value = [
            {"id": 1, "url": "https://example.com", "frequency": "weekly", "enabled": True},
        ]
        resp = client.get("/api/crawl-schedules", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert len(data["items"]) == 1

    def test_create_schedule_success(self, client, db_mock, authed_headers):
        db_mock.create_crawl_schedule.return_value = {
            "id": 1, "url": "https://example.com", "frequency": "weekly"
        }
        resp = client.post("/api/crawl-schedules",
                           json={"url": "https://example.com", "frequency": "weekly"},
                           headers=authed_headers)
        assert resp.status_code == 201
        assert resp.get_json()["ok"] is True

    def test_create_schedule_missing_url_400(self, client, authed_headers):
        resp = client.post("/api/crawl-schedules",
                           json={"frequency": "weekly"},
                           headers=authed_headers)
        assert resp.status_code == 400

    def test_invalid_frequency_defaults_to_weekly(self, client, db_mock, authed_headers):
        db_mock.create_crawl_schedule.return_value = {
            "id": 1, "url": "https://example.com", "frequency": "weekly"
        }
        captured = {}
        def _cap(url, freq):
            captured["freq"] = freq
            return {"id": 1, "url": url, "frequency": freq}
        db_mock.create_crawl_schedule.side_effect = _cap
        client.post("/api/crawl-schedules",
                    json={"url": "https://example.com", "frequency": "yearly"},
                    headers=authed_headers)
        assert captured["freq"] == "weekly"
        db_mock.create_crawl_schedule.side_effect = None

    def test_patch_schedule_enable(self, client, db_mock, authed_headers):
        resp = client.patch("/api/crawl-schedules/1",
                            json={"enabled": True},
                            headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_patch_schedule_nothing_to_update_400(self, client, db_mock, authed_headers):
        resp = client.patch("/api/crawl-schedules/1", json={}, headers=authed_headers)
        assert resp.status_code == 400

    def test_delete_schedule(self, client, db_mock, authed_headers):
        resp = client.delete("/api/crawl-schedules/1", headers=authed_headers)
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_no_auth_401(self, client):
        for method, url in [
            ("GET",    "/api/crawl-schedules"),
            ("POST",   "/api/crawl-schedules"),
            ("PATCH",  "/api/crawl-schedules/1"),
            ("DELETE", "/api/crawl-schedules/1"),
        ]:
            resp = getattr(client, method.lower())(url)
            assert resp.status_code == 401, f"{method} {url} should be 401"


# ── /api/crawl/<id>/summary ───────────────────────────────────────────────────

class TestCrawlAISummary:
    def test_returns_stored_summary(self, client, db_mock, authed_headers):
        import json
        summary_data = {"overall_health": "Good", "major_risks": []}
        db_mock.get_crawl_ai_summary.return_value = json.dumps(summary_data)
        resp = client.get(f"/api/crawl/{FAKE_CRAWL_ID}/summary", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["available"] is True
        assert data["summary"]["overall_health"] == "Good"

    def test_no_summary_available(self, client, db_mock, authed_headers):
        db_mock.get_crawl_ai_summary.return_value = None
        with patch("backend.services.ai_summary_service.generate_and_store_summary"):
            resp = client.get(f"/api/crawl/{FAKE_CRAWL_ID}/summary", headers=authed_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["available"] is False

    def test_no_auth_401(self, client):
        resp = client.get(f"/api/crawl/{FAKE_CRAWL_ID}/summary")
        assert resp.status_code == 401
