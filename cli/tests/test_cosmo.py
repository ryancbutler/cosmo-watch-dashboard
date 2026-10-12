import contextlib
import io
import json
import re
import tempfile
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cosmo


def response(payload=None, *, status=200, content=None):
    r = Mock(status_code=status)
    r.content = content if content is not None else json.dumps(payload).encode()
    r.text = r.content.decode(errors="replace")
    r.headers = {"Content-Type": "application/octet-stream" if content is not None else "application/json"}
    if content is not None:
        r.json.side_effect = ValueError("not JSON")
    else:
        r.json.return_value = payload
    return r


class ReadTests(unittest.TestCase):
    def setUp(self):
        with patch.object(cosmo.CosmoClient, "_load_cache"):
            self.client = cosmo.CosmoClient("test@example.com", "secret", verbose=True)
        self.client.access = "test-token"
        self.client.session = Mock()

    def test_every_swagger_get_has_a_named_command(self):
        spec = (cosmo.ROOT.parent / "api/openapi.yaml").read_text()
        gets = set(re.findall(r"^  (/v2/[^\n:]+):\n    get:", spec, re.M))
        actual = {"/v2/map"} | {"/v2" + entry[0] for entry in cosmo.READ_ENDPOINTS.values()}
        normalize = lambda paths: {re.sub(r"\{[^}]+\}", "{id}", p) for p in paths}
        self.assertEqual(normalize(gets), normalize(actual))

    def test_all_resources_use_get_and_correct_route(self):
        self.client.request = Mock(return_value={"status": 200})
        for name, (path, kind, _) in cosmo.READ_ENDPOINTS.items():
            with self.subTest(name=name):
                self.client.get_resource(name, 123 if kind else None)
                self.client.request.assert_called_with(
                    "GET", path.format(id="123"), binary=name in cosmo.IMAGE_COMMANDS
                )

    def test_unsupported_routes_are_not_exposed(self):
        for name in ("firmware", "permissions", "contact-permissions", "medications", "wifi", "raw"):
            with self.subTest(name=name):
                self.assertNotIn(name, cosmo.READ_ENDPOINTS)
                with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                    cosmo.build_parser().parse_args([name])

    def test_invalid_ids_never_send_a_request(self):
        self.client.request = Mock()
        for value in (None, "../123", "123?other=1", "abc"):
            with self.assertRaises(ValueError):
                self.client.get_resource("device-profile", value)
        self.client.request.assert_not_called()

    def test_swagger_paths_do_not_duplicate_v2(self):
        self.client.session.request.return_value = response({"status": 200})
        for path in ("/v2/contact", "v2/contact", "/contact", "contact"):
            with contextlib.redirect_stderr(io.StringIO()):
                self.client.request("GET", path)
            self.assertEqual(self.client.session.request.call_args.args[1], cosmo.API_BASE + "/contact")

    def test_binary_and_json_image_responses(self):
        self.client.session.request.return_value = response(content=b"\x89PNG\r\n")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self.client.get_resource("user-image"), b"\x89PNG\r\n")
        self.client.session.request.return_value = response({"status": 200, "data": "image-url"})
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertIsInstance(self.client.get_resource("user-image"), dict)

    def test_invalid_json_is_api_error(self):
        self.client.session.request.return_value = response(content=b"<html>error</html>")
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(cosmo.CosmoApiError):
            self.client.get_resource("contacts")

    def test_http_and_envelope_errors(self):
        for r in (response({"message": "missing"}, status=404), response({"status": 400, "message": "bad request"})):
            self.client.session.request.return_value = r
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(cosmo.CosmoApiError):
                self.client.get_resource("contacts")

    def test_image_does_not_save_an_html_error_page(self):
        r = response(content=b"<html>error</html>")
        r.headers = {"Content-Type": "text/html"}
        self.client.session.request.return_value = r
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(cosmo.CosmoApiError):
            self.client.get_resource("user-image")

    def test_expired_image_request_retries_with_options(self):
        self.client.login = Mock()
        self.client.session.request.side_effect = [response({"status": 2}), response(content=b"image")]
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self.client.get_resource("user-image"), b"image")
        self.client.login.assert_called_once()
        self.assertEqual(self.client.session.request.call_count, 2)

    def test_external_host_rejected_before_auth_or_transport(self):
        self.client.ensure_token = Mock()
        with self.assertRaises(cosmo.CosmoApiError):
            self.client.request("GET", "https://example.com/v2/map")
        self.client.ensure_token.assert_not_called()
        self.client.session.request.assert_not_called()

    def test_verbose_auth_does_not_log_secrets(self):
        self.client.session.request.return_value = response({"status": 200})
        log = io.StringIO()
        with contextlib.redirect_stderr(log):
            self.client.request("POST", "/token", auth=False, json_body={"password": "very-secret"})
        self.assertNotIn("very-secret", log.getvalue())

    def test_cli_selection_and_explicit_conversation_ids(self):
        parser = cosmo.build_parser()
        args = parser.parse_args(["device-profile"])
        with patch.dict("os.environ", {"COSMO_DEVICE_ID": "123"}), contextlib.redirect_stdout(io.StringIO()):
            self.client.get_resource = Mock(return_value={})
            args.func(self.client, args)
        self.client.get_resource.assert_called_once_with("device-profile", "123")
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parser.parse_args(["group-messages"])

    def test_send_message_requires_confirmation_and_uses_device_chat_route(self):
        parser = cosmo.build_parser()
        args = parser.parse_args(["send-message", "123", "Test message"])
        self.client.request = Mock()
        with self.assertRaisesRegex(ValueError, "--yes"):
            args.func(self.client, args)
        self.client.request.assert_not_called()

        args = parser.parse_args(["send-message", "123", "Test message", "--yes"])
        self.client.get_resource = Mock(return_value={"data": {"devices": [{"id": 123}]}})
        self.client.request = Mock(return_value={"status": 200})
        with contextlib.redirect_stdout(io.StringIO()):
            args.func(self.client, args)
        self.client.request.assert_called_once_with(
            "POST", "/tokk/device/123/message", json_body={"messageType": 1, "data": "Test message"}
        )

    def test_create_safe_zone_requires_confirmation_and_uses_expected_route(self):
        parser = cosmo.build_parser()
        command = [
            "create-safe-zone", "School", "43.0594563", "-88.0639778", "--device", "123", "--device", "456",
        ]
        args = parser.parse_args(command)
        self.client.request = Mock()
        with self.assertRaisesRegex(ValueError, "--yes"):
            args.func(self.client, args)
        self.client.request.assert_not_called()

        args = parser.parse_args(command + ["--yes"])
        self.client.request = Mock(return_value={"status": 200})
        with contextlib.redirect_stdout(io.StringIO()):
            args.func(self.client, args)
        self.client.request.assert_called_once_with(
            "POST", "/safezones", json_body={
                "name": "School", "latitude": "43.0594563", "longitude": "-88.0639778",
                "radius": 200, "enabled": True, "type": 0,
                "devices": [
                    {"deviceId": 123, "enable": True, "silent": False, "silentDays": [1, 2, 3, 4, 5, 6, 7]},
                    {"deviceId": 456, "enable": True, "silent": False, "silentDays": [1, 2, 3, 4, 5, 6, 7]},
                ],
            },
        )

    def test_create_focus_mode_requires_confirmation_and_uses_expected_route(self):
        parser = cosmo.build_parser()
        command = [
            "create-focus-mode", "School", "08:30", "14:00", "--device", "123", "--device", "456",
            "--days", "sun,mon,tue,wed,thu",
        ]
        args = parser.parse_args(command)
        self.client.request = Mock()
        with self.assertRaisesRegex(ValueError, "--yes"):
            args.func(self.client, args)
        self.client.request.assert_not_called()

        args = parser.parse_args(command + ["--yes"])
        self.client.request = Mock(return_value={"status": 200})
        with contextlib.redirect_stdout(io.StringIO()):
            args.func(self.client, args)
        self.client.request.assert_called_once_with(
            "POST", "/alarms", json_body={
                "Devices": [123, 456], "Enabled": True, "EndTime": 50400,
                "focusMode": False, "Lockdown": False, "Message": "School", "Name": "School",
                "owning": True, "SchoolMode": True, "silentMode": False, "Time": 30600,
                "Type": 4, "WeekDays": [True, True, True, True, False, False, True],
            },
        )

    def test_create_focus_mode_lockdown_requires_confirmation_and_sets_payload(self):
        parser = cosmo.build_parser()
        command = [
            "create-focus-mode", "School", "08:30", "14:00", "--device", "123", "--lockdown",
        ]
        args = parser.parse_args(command)
        self.client.request = Mock()
        with self.assertRaisesRegex(ValueError, "--yes"):
            args.func(self.client, args)
        self.client.request.assert_not_called()

        args = parser.parse_args(command + ["--yes"])
        self.client.request = Mock(return_value={"status": 200})
        with contextlib.redirect_stdout(io.StringIO()):
            args.func(self.client, args)
        self.client.request.assert_called_once_with(
            "POST", "/alarms", json_body={
                "Devices": [123], "Enabled": True, "EndTime": 50400,
                "focusMode": False, "Lockdown": True, "Message": "School", "Name": "School",
                "owning": True, "SchoolMode": True, "silentMode": False, "Time": 30600,
                "Type": 4, "WeekDays": [True, True, True, True, True, False, False],
            },
        )

    def test_focus_mode_body_defaults_lockdown_to_off(self):
        body = cosmo.build_focus_mode_body(
            "School", "08:30", "14:00", ["123"], cosmo.parse_week_days("mon"),
        )
        self.assertIs(body["Lockdown"], False)

    def test_image_output_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "image.png"
            args = cosmo.build_parser().parse_args(["user-image", "--output", str(dest)])
            self.client.get_resource = Mock(return_value=b"image")
            with contextlib.redirect_stderr(io.StringIO()):
                args.func(self.client, args)
            self.assertEqual(dest.read_bytes(), b"image")
            with self.assertRaises(FileExistsError):
                args.func(self.client, args)

    def test_backup_chats_saves_all_rostered_conversations_and_media(self):
        roster = {
            "status": 200,
            "data": {
                "devices": [{"id": 7, "name": "Watch"}],
                "users": [{"id": 8, "name": "Parent"}],
                "groups": [{"id": 9, "name": "Family"}],
            },
        }
        device_messages = {
            "status": 200,
            "data": [
                {"messageId": 10, "messageType": 1, "data": "hello"},
                {"messageId": 11, "messageType": 4, "data": "https://api.myfilip.com/photo.jpg"},
                {"messageId": 12, "messageType": 3, "data": "https://api.myfilip.com/voice.aac"},
            ],
        }
        self.client.get_resource = Mock(side_effect=[roster, device_messages, {"status": 200, "data": []}, {"status": 200, "data": []}])
        self.client.download_chat_attachment = Mock(side_effect=[(b"photo", "image/jpeg"), (b"voice", "audio/aac")])
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "backup"
            args = cosmo.build_parser().parse_args(["backup-chats", str(destination)])
            with contextlib.redirect_stdout(io.StringIO()):
                args.func(self.client, args)
            manifest = json.loads((destination / "manifest.json").read_text())
            self.assertEqual(manifest["format"], "cosmo-chat-backup-v1")
            self.assertEqual(len(manifest["conversations"]), 3)
            self.assertEqual(len(manifest["attachments"]), 2)
            self.assertEqual(manifest["attachments"][0]["sha256"], cosmo.hashlib.sha256(b"photo").hexdigest())
            self.assertTrue((destination / "conversations" / "device-7.json").exists())
            self.assertEqual((destination / manifest["attachments"][1]["file"]).read_bytes(), b"voice")

    def test_backup_chats_never_reuses_a_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "existing"
            destination.mkdir()
            args = cosmo.build_parser().parse_args(["backup-chats", str(destination)])
            self.client.get_resource = Mock()
            with self.assertRaises(FileExistsError):
                args.func(self.client, args)
            self.client.get_resource.assert_not_called()

    def test_api_attachment_reauthenticates_once(self):
        self.client.session.request.side_effect = [response({}, status=401), response(content=b"voice")]
        self.client.login = Mock()
        with contextlib.redirect_stderr(io.StringIO()):
            payload, content_type = self.client.download_chat_attachment("https://api.myfilip.com/voice.aac")
        self.assertEqual((payload, content_type), (b"voice", "application/octet-stream"))
        self.client.login.assert_called_once()
        self.assertEqual(self.client.session.request.call_count, 2)

    def test_403_is_permission_error_without_login_retry(self):
        self.client.login = Mock()
        for r in (response({"message": "Forbidden"}, status=403), response({"status": 403})):
            self.client.session.request.reset_mock()
            self.client.session.request.return_value = r
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(cosmo.CosmoPermissionError):
                self.client.get_resource("device-messages", 123)
            self.client.session.request.assert_called_once()
        self.client.login.assert_not_called()

    def test_401_still_reauthenticates_once(self):
        self.client.login = Mock()
        self.client.session.request.side_effect = [response({}, status=401), response({"status": 200, "data": []})]
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self.client.get_resource("user-messages", 123)["status"], 200)
        self.client.login.assert_called_once()

    def test_message_cli_rejects_ids_outside_matching_roster(self):
        for kind in ("device", "user", "group"):
            args = cosmo.build_parser().parse_args([kind + "-messages", "456"])
            self.client.get_resource = Mock(return_value={"data": {kind + "s": [{"id": 123}]}})
            with self.assertRaisesRegex(ValueError, "conversation id"):
                args.func(self.client, args)
            self.client.get_resource.assert_called_once_with("chats")

    def test_message_cli_uses_matching_roster_id(self):
        for kind in ("device", "user", "group"):
            args = cosmo.build_parser().parse_args([kind + "-messages", "123"])
            self.client.get_resource = Mock(side_effect=[{"data": {kind + "s": [{"id": 123}]}}, {"status": 200, "data": []}])
            with contextlib.redirect_stdout(io.StringIO()):
                args.func(self.client, args)
            self.assertEqual(self.client.get_resource.call_count, 2)
            self.client.get_resource.assert_called_with(kind + "-messages", "123")

    def test_daily_steps_routes_without_sync_and_validates_before_request(self):
        self.client.request = Mock(return_value={"data": {"stepcount": []}})
        self.client.get_daily_steps("123", "2026-01-01", "2026-02-01")
        self.client.request.assert_called_once_with(
            "POST", "/stepcounter/list/daily/simple/123",
            json_body={"startDate": "2026-01-01", "endDate": "2026-02-01"},
        )
        self.client.request.reset_mock()
        for watch, start, end in [
            ("../123", "2026-01-01", "2026-01-02"),
            ("123", "2026-01-01", "2026-02-02"),
            ("123", "2026-01-02", "2026-01-01"),
            ("123", "2026-02-30", "2026-03-01"),
            ("123", "20260101", "2026-01-02"),
        ]:
            with self.subTest(watch=watch, start=start, end=end), self.assertRaises(ValueError):
                self.client.get_daily_steps(watch, start, end)
        self.client.request.assert_not_called()

    def test_daily_cli_invalid_dates_do_not_resolve_watch(self):
        client = Mock()
        args = cosmo.build_parser().parse_args(["daily-steps", "--from", "2026-01-02", "--to", "2026-01-01"])
        with self.assertRaises(ValueError):
            args.func(client, args)
        self.assertEqual(client.mock_calls, [])

    def test_tracking_requires_yes_before_any_request(self):
        for argv in (["locate", "123"], ["stop", "123"], ["device", "123", "--turbo"]):
            client = Mock()
            args = cosmo.build_parser().parse_args(argv)
            with self.subTest(argv=argv), self.assertRaisesRegex(ValueError, "--yes"):
                args.func(client, args)
            self.assertEqual(client.mock_calls, [])

    def test_personal_outputs_cannot_target_checkout(self):
        client = Mock()
        for argv in (
            ["backup-chats", str(cosmo.ROOT.parent / "private-backup")],
            ["user-image", "--output", str(cosmo.ROOT / "private-image.png")],
        ):
            args = cosmo.build_parser().parse_args(argv)
            with self.subTest(argv=argv), self.assertRaisesRegex(ValueError, "outside"):
                args.func(client, args)
            self.assertEqual(client.mock_calls, [])


if __name__ == "__main__":
    unittest.main()
