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


def focus_schedule(**changes):
    schedule = {
        "Id": 7, "title": "School", "message": "Learning time", "enabled": True,
        "time": 30600, "endTime": 50400, "weekDays": [True, True, True, True, True, False, False],
        "devices": [{"id": 123}, {"id": 456}], "schoolMode": True, "focusMode": False,
        "lockdown": True, "owning": True, "silentMode": False, "snooze": False, "type": 4,
        "date": "2026-10-12", "allowedToSee": True,
    }
    schedule.update(changes)
    return schedule


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

    def test_delete_commands_require_confirmation_before_requests(self):
        for command in ("delete-focus-mode", "delete-safe-zone"):
            with self.subTest(command=command):
                args = cosmo.build_parser().parse_args([command, "123"])
                self.client.request = Mock()
                with self.assertRaisesRegex(ValueError, "--yes"):
                    args.func(self.client, args)
                self.client.request.assert_not_called()

    def test_delete_commands_use_documented_routes_and_emit_response(self):
        for command, path in (("delete-focus-mode", "/alarms/123"), ("delete-safe-zone", "/safezones/123")):
            with self.subTest(command=command):
                args = cosmo.build_parser().parse_args([command, "123", "--yes"])
                self.client.session.request.reset_mock()
                self.client.session.request.return_value = response({"status": 200})
                output = io.StringIO()
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
                    args.func(self.client, args)
                self.client.session.request.assert_called_once()
                request = self.client.session.request.call_args
                self.assertEqual(request.args, ("DELETE", cosmo.API_BASE + path))
                self.assertIsNone(request.kwargs["json"])
                self.assertEqual(json.loads(output.getvalue()), {"status": 200})

    def test_delete_commands_reject_invalid_ids_before_requests(self):
        self.client.request = Mock()
        for command in ("delete-focus-mode", "delete-safe-zone"):
            for resource_id in ("", "../123", "123/456", "123?other=1", "abc", "１２３", " 123", "123#fragment"):
                with self.subTest(command=command, resource_id=resource_id):
                    args = cosmo.build_parser().parse_args([command, resource_id, "--yes"])
                    with self.assertRaisesRegex(ValueError, "numeric"):
                        args.func(self.client, args)
        self.client.request.assert_not_called()

    def test_delete_commands_require_explicit_resource_id(self):
        with patch.dict("os.environ", {"COSMO_DEVICE_ID": "456"}):
            for command in ("delete-focus-mode", "delete-safe-zone"):
                with self.subTest(command=command):
                    with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                        cosmo.build_parser().parse_args([command, "--yes"])

    def test_delete_commands_handle_empty_success_and_service_errors(self):
        self.client.login = Mock()
        for command in ("delete-focus-mode", "delete-safe-zone"):
            for status in (204, 403, 404):
                with self.subTest(command=command, status=status):
                    args = cosmo.build_parser().parse_args([command, "123", "--yes"])
                    self.client.session.request.reset_mock()
                    self.client.session.request.return_value = response(status=status, content=b"")
                    output = io.StringIO()
                    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
                        if status == 204:
                            args.func(self.client, args)
                            self.assertEqual(json.loads(output.getvalue()), {})
                        else:
                            with self.assertRaises(cosmo.CosmoApiError):
                                args.func(self.client, args)
                            self.assertEqual(output.getvalue(), "")
                    self.client.session.request.assert_called_once()
        self.client.login.assert_not_called()

    def test_schedule_update_and_unregistration_require_confirmation_before_reads(self):
        self.client.request = Mock()
        for command in (
            ["update-focus-mode", "7", "--disable"],
            ["update-focus-mode", "7", "--remove-device", "123"],
            ["unregister-device", "123", "--delete-esim"],
        ):
            with self.subTest(command=command):
                args = cosmo.build_parser().parse_args(command)
                with self.assertRaisesRegex(ValueError, "--yes"):
                    args.func(self.client, args)
        self.client.request.assert_not_called()

    def test_schedule_update_preserves_settings_and_verifies_readback(self):
        expected = {
            "Id": 7, "Name": "School", "Message": "Learning time", "Enabled": True,
            "Time": 30600, "EndTime": 50400, "WeekDays": [True, True, True, True, True, False, False],
            "Devices": [123, 456], "SchoolMode": True, "focusMode": False, "Lockdown": True,
            "owning": True, "silentMode": False, "Snooze": False, "Type": 4,
            "Date": "2026-10-12", "allowedToSee": True,
        }
        for flags, changes, payload_changes in (
            (["--disable"], {"enabled": False}, {"Enabled": False}),
            (["--enable"], {"enabled": True}, {"Enabled": True}),
            (["--remove-device", "123"], {"devices": [{"id": 456}]}, {"Devices": [456]}),
            (["--disable", "--remove-device", "456"], {"enabled": False, "devices": [{"id": 123}]}, {"Enabled": False, "Devices": [123]}),
        ):
            with self.subTest(flags=flags):
                original = focus_schedule(enabled=flags != ["--enable"])
                self.client.session.request.reset_mock()
                self.client.session.request.side_effect = [
                    response({"data": [original]}), response({"status": 200}),
                    response({"data": [focus_schedule(**changes)]}),
                ]
                args = cosmo.build_parser().parse_args(["update-focus-mode", "7", *flags, "--yes"])
                output = io.StringIO()
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
                    args.func(self.client, args)
                calls = self.client.session.request.call_args_list
                self.assertEqual([call.args for call in calls], [
                    ("GET", cosmo.API_BASE + "/alarms"), ("PUT", cosmo.API_BASE + "/alarms/7"),
                    ("GET", cosmo.API_BASE + "/alarms"),
                ])
                self.assertEqual(calls[1].kwargs["json"], expected | payload_changes)
                self.assertEqual(json.loads(output.getvalue()), {"status": 200})
                self.assertEqual(original, focus_schedule(enabled=flags != ["--enable"]))

    def test_schedule_update_dry_run_is_get_only_and_accepts_lowercase_id(self):
        schedule = focus_schedule()
        schedule["id"] = schedule.pop("Id")
        self.client.get_resource = Mock(return_value={"data": [schedule]})
        self.client.request = Mock()
        args = cosmo.build_parser().parse_args(["update-focus-mode", "7", "--disable", "--dry-run"])
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            args.func(self.client, args)
        self.client.get_resource.assert_called_once_with("alarms")
        self.client.request.assert_not_called()
        preview = json.loads(output.getvalue())
        self.assertEqual((preview["method"], preview["path"]), ("PUT", "/v2/alarms/7"))
        self.assertIs(preview["body"]["Enabled"], False)
        self.assertIs(preview["body"]["Lockdown"], True)
        self.assertIs(preview["dryRun"], True)

    def test_schedule_update_validates_inputs_before_reads(self):
        self.client.request = Mock()
        for command in (
            ["update-focus-mode", "7"],
            ["update-focus-mode", "../7", "--disable"],
            ["update-focus-mode", "7", "--remove-device", "１２３"],
            ["update-focus-mode", "7", "--remove-device", "123", "--remove-device", "0123"],
            ["unregister-device", "0"], ["unregister-device", "2147483648"],
        ):
            with self.subTest(command=command):
                args = cosmo.build_parser().parse_args(command + ["--yes"])
                with self.assertRaises(ValueError):
                    args.func(self.client, args)
        self.client.request.assert_not_called()
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            cosmo.build_parser().parse_args(["update-focus-mode", "7", "--enable", "--disable"])
        for command in ("update-focus-mode", "unregister-device"):
            with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                cosmo.build_parser().parse_args([command, "--yes"])

    def test_schedule_update_rejects_unsafe_targets_without_writing(self):
        incomplete = focus_schedule()
        del incomplete["lockdown"]
        for data, flags in (
            ([], ["--disable"]),
            ([focus_schedule(), focus_schedule()], ["--disable"]),
            ([focus_schedule(schoolMode=False)], ["--disable"]),
            ([incomplete], ["--disable"]),
            ([focus_schedule(enabled="true")], ["--disable"]),
            ([focus_schedule(weekDays=[True])], ["--disable"]),
            ([focus_schedule(devices=[{"id": "../123"}])], ["--disable"]),
            ([focus_schedule()], ["--remove-device", "789"]),
            ([focus_schedule()], ["--remove-device", "123", "--remove-device", "456"]),
            ({"alarms": []}, ["--disable"]),
        ):
            with self.subTest(data=data, flags=flags):
                self.client.get_resource = Mock(return_value={"data": data})
                self.client.request = Mock()
                args = cosmo.build_parser().parse_args(["update-focus-mode", "7", *flags, "--yes"])
                with self.assertRaises(ValueError):
                    args.func(self.client, args)
                self.client.request.assert_not_called()

    def test_new_mutations_do_not_replay_after_auth_or_transport_failure(self):
        self.client.login = Mock()
        for method, path in (("PUT", "/alarms/7"), ("POST", "/device/unregister")):
            for failure in (response(status=401), response({"status": 2}), cosmo.requests.Timeout("lost response")):
                with self.subTest(method=method, failure=failure):
                    self.client.session.request.reset_mock()
                    self.client.session.request.side_effect = [failure]
                    with self.assertRaisesRegex(cosmo.CosmoApiError, "Read current state"), contextlib.redirect_stderr(io.StringIO()):
                        cosmo.request_confirmed_mutation(self.client, method, path, {"deviceId": 123})
                    self.client.session.request.assert_called_once()
        self.client.login.assert_not_called()

    def test_schedule_update_reports_failed_verification_without_repeating_write(self):
        self.client.get_resource = Mock(side_effect=[{"data": [focus_schedule()]}, {"data": [focus_schedule()]}])
        self.client.request = Mock(return_value={"status": 200})
        args = cosmo.build_parser().parse_args(["update-focus-mode", "7", "--disable", "--yes"])
        with self.assertRaisesRegex(cosmo.CosmoApiError, "readback"), contextlib.redirect_stdout(io.StringIO()):
            args.func(self.client, args)
        self.client.request.assert_called_once()

    def test_schedule_update_readback_accepts_equivalent_assignment_order(self):
        self.client.get_resource = Mock(side_effect=[
            {"data": [focus_schedule(devices=[{"id": 456}, {"id": 123}])]},
            {"data": [focus_schedule(enabled=False)]},
        ])
        self.client.request = Mock(return_value={"status": 200})
        args = cosmo.build_parser().parse_args(["update-focus-mode", "7", "--disable", "--yes"])
        with contextlib.redirect_stdout(io.StringIO()):
            args.func(self.client, args)
        self.client.request.assert_called_once()

    def test_unregister_device_uses_wire_alias_and_verifies_account_removal(self):
        for flags, delete_esim in (([], False), (["--delete-esim"], True)):
            with self.subTest(flags=flags):
                self.client.session.request.reset_mock()
                self.client.session.request.side_effect = [
                    response({"data": {"Devices": [{"id": 123}, {"id": 456}]}}),
                    response({"status": 200}), response({"data": {"Devices": [{"id": 456}]}}),
                ]
                args = cosmo.build_parser().parse_args(["unregister-device", "123", *flags, "--yes"])
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    args.func(self.client, args)
                calls = self.client.session.request.call_args_list
                self.assertEqual([call.args for call in calls], [
                    ("GET", cosmo.API_BASE + "/map"), ("POST", cosmo.API_BASE + "/device/unregister"),
                    ("GET", cosmo.API_BASE + "/map"),
                ])
                self.assertEqual(calls[1].kwargs["json"], {"deviceId": 123, "deleteEsim": delete_esim})

    def test_unregister_device_dry_run_does_not_write(self):
        self.client.get_device = Mock(return_value={"id": 123})
        self.client.request = Mock()
        args = cosmo.build_parser().parse_args(["unregister-device", "123", "--dry-run"])
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            args.func(self.client, args)
        self.client.get_device.assert_called_once_with(123)
        self.client.request.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()), {
            "method": "POST", "path": "/v2/device/unregister",
            "body": {"deviceId": 123, "deleteEsim": False}, "dryRun": True,
        })

    def test_unregister_device_rejects_unknown_target_and_failed_readback(self):
        args = cosmo.build_parser().parse_args(["unregister-device", "123", "--yes"])
        self.client.get_device = Mock(return_value=None)
        self.client.request = Mock(return_value={"status": 200})
        with self.assertRaisesRegex(ValueError, "not listed"):
            args.func(self.client, args)
        self.client.request.assert_not_called()
        self.client.get_device = Mock(return_value={"id": 123})
        with self.assertRaisesRegex(cosmo.CosmoApiError, "readback"):
            args.func(self.client, args)
        self.client.request.assert_called_once_with(
            "POST", "/device/unregister", json_body={"deviceId": 123, "deleteEsim": False}, retry_auth=False,
        )

    def test_device_list_requires_explicit_supported_roster(self):
        for payload in ({}, {"data": {}}, {"data": {"Devices": None}}, {"data": {"Devices": [None]}}, {"data": {"Devices": [{}]}}):
            with self.subTest(payload=payload):
                self.client.get_map = Mock(return_value=payload)
                with self.assertRaises(cosmo.CosmoApiError):
                    self.client.get_devices()
        self.client.get_map = Mock(return_value={"data": {"Devices": []}})
        self.assertEqual(self.client.get_devices(), [])

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
