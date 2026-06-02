import logging
import json


class JsonFormatter(logging.Formatter):
    def format(self, record):
        payload = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "request_id") and record.request_id:
            payload["requestId"] = record.request_id
        if hasattr(record, "job_id") and record.job_id:
            payload["jobId"] = record.job_id
        if hasattr(record, "source") and record.source:
            payload["source"] = record.source
        if hasattr(record, "scan_url") and record.scan_url:
            payload["scanUrl"] = record.scan_url
        if hasattr(record, "duration") and record.duration is not None:
            payload["duration"] = record.duration
        if hasattr(record, "worker_status") and record.worker_status:
            payload["workerStatus"] = record.worker_status
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging(level="INFO"):
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = []
    root.setLevel(level)
    root.addHandler(handler)
