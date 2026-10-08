"""Trigger the hosted collector; never fetch watch data or print its credential."""
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

SITE_ORIGIN = os.environ.get("SITE_ORIGIN", "https://dashboard.example.com")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "Redirect refused", headers, fp)


def trigger(site_url, token, opener=None):
    origin = urlsplit(SITE_ORIGIN)
    if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
            or origin.port is not None or origin.path or origin.query or origin.fragment
            or site_url.rstrip("/") != SITE_ORIGIN or not token.strip()):
        raise ValueError("Invalid collector configuration")
    request = urllib.request.Request(
        SITE_ORIGIN + "/api/collect",
        data=b"",
        method="POST",
        headers={
            "OAI-Sites-Authorization": "Bearer " + token.strip(),
            "Accept": "application/json",
            "User-Agent": "cosmo-cluster-scheduler/1.0",
        },
    )
    with (opener or urllib.request.build_opener(NoRedirect())).open(request, timeout=150) as response:
        result = json.loads(response.read(4096))
    if result.get("status") not in {"ok", "partial", "busy", "already-collected"}:
        raise ValueError("Collector did not succeed")
    summary = {"status": result["status"]}
    count = result.get("records")
    if isinstance(count, int) and not isinstance(count, bool) and count >= 0:
        summary["records"] = count
    return summary


def main():
    try:
        token = Path("/var/run/secrets/cosmo/service-token").read_text()
        result = trigger(os.environ["SITE_URL"], token)
        print(json.dumps(result), flush=True)
        return 0
    except urllib.error.HTTPError as error:
        print(json.dumps({"status": "failed", "http_status": error.code}), file=sys.stderr, flush=True)
    except Exception:
        print(json.dumps({"status": "failed", "error": "Collector request failed"}), file=sys.stderr, flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
