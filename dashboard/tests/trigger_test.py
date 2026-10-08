import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location("trigger", Path(__file__).resolve().parents[1] / "deploy" / "collector-trigger.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Opener:
    def __init__(self, status="ok"):
        self.status = status
        self.request = None

    def open(self, request, timeout):
        self.request = request
        assert timeout == 150
        return io.BytesIO(json.dumps({"status": self.status, "records": 2, "private": "MUST-NOT-LOG"}).encode())


class TriggerTests(unittest.TestCase):
    def test_only_posts_to_the_known_private_collector_and_outputs_counts(self):
        opener = Opener()
        self.assertEqual(module.trigger(module.SITE_ORIGIN, "fictional-token", opener), {"status": "ok", "records": 2})
        self.assertEqual(opener.request.full_url, module.SITE_ORIGIN + "/api/collect")
        self.assertEqual(opener.request.get_method(), "POST")
        self.assertEqual(opener.request.get_header("Oai-sites-authorization"), "Bearer fictional-token")

    def test_rejects_other_hosts_and_failed_collection(self):
        with self.assertRaises(ValueError):
            module.trigger("https://other.example", "fictional-token", Opener())
        with self.assertRaises(ValueError):
            module.trigger(module.SITE_ORIGIN, "fictional-token", Opener("failed"))
        self.assertEqual(module.trigger(module.SITE_ORIGIN, "fictional-token", Opener("busy"))["status"], "busy")

    def test_configured_origin_must_be_https_without_credentials_or_extra_parts(self):
        for origin in ("http://dashboard.example.com", "https://user:pass@dashboard.example.com", "https://dashboard.example.com/path", "https://dashboard.example.com?token=secret", "https://dashboard.example.com#fragment", "https://dashboard.example.com:443"):
            with self.subTest(origin=origin), patch.object(module, "SITE_ORIGIN", origin), self.assertRaises(ValueError):
                module.trigger(origin, "fictional-token", Opener())
        with patch.object(module, "SITE_ORIGIN", "https://my-dashboard.example.com"):
            opener = Opener()
            module.trigger(module.SITE_ORIGIN, "fictional-token", opener)
            self.assertEqual(opener.request.full_url, "https://my-dashboard.example.com/api/collect")

    def test_never_redirects_credentials(self):
        with self.assertRaises(urllib.error.HTTPError):
            module.NoRedirect().redirect_request(NoneRequest(), None, 302, "Found", {}, "https://other.example")


class NoneRequest:
    full_url = module.SITE_ORIGIN + "/api/collect"


if __name__ == "__main__":
    unittest.main()
