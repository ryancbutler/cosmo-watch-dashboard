#!/usr/bin/env python3
"""Explore the FiLIP API (api.myfilip.com) that backs the COSMO JrTrack watch.

This unofficial tool is provided for informational and educational purposes.
It supports authentication, last-known watch state, named resource reads,
stored daily-step queries, and explicitly confirmed watch-setting changes.
Endpoint availability and behavior may vary by account and device.

Credentials come from env vars or a .env file:
    COSMO_EMAIL, COSMO_PASSWORD, [COSMO_DEVICE_ID]

Examples:
    python cosmo.py devices
    python cosmo.py --save map
    python cosmo.py device
    python cosmo.py locate
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

import requests
from dotenv import load_dotenv

API_BASE = "https://api.myfilip.com/v2"
WHITE_LABEL_ID = 18
APP_BUILD = "3.4.0.710"

EP_TOKEN = "/token"
EP_TOKEN_REFRESH = "/token/refresh"
EP_MAP = "/map"

TOKEN_REFRESH_MARGIN = timedelta(minutes=2)
ACTIVE_TRACKING_DURATION = 300  # seconds the watch stays in turbo
ACTIVE_TRACKING_FREQUENCY = 10  # seconds between fixes while in turbo
SAFE_ZONE_MIN_RADIUS = 200
SAFE_ZONE_MAX_RADIUS = 600
WEEKDAY_NAMES = {
    "mon": 0, "monday": 0,
    "tue": 1, "tues": 1, "tuesday": 1,
    "wed": 2, "wednesday": 2,
    "thu": 3, "thur": 3, "thurs": 3, "thursday": 3,
    "fri": 4, "friday": 4,
    "sat": 5, "saturday": 5,
    "sun": 6, "sunday": 6,
}
# Poll frequently at first, for about two minutes in total.
POLL_DELAYS = (8, 8, 12, 15, 20, 25, 30)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "cosmo-api-explorer/0.1 (personal research script)"

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("COSMO_DATA_DIR") or (
    Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local/share") / "cosmo-api-explorer"
)).expanduser().resolve()
ENV_FILE = Path(os.environ.get("COSMO_ENV_FILE") or DATA_DIR / ".env").expanduser()
TOKEN_CACHE = DATA_DIR / ".tokens.json"
CAPTURE_DIR = DATA_DIR / "captures"
CHAT_MEDIA_TYPES = {3: "audio", 4: "image"}

# GET routes from api/openapi.yaml. The second field selects the id source;
# only device ids may default to COSMO_DEVICE_ID or the account's sole watch.
READ_ENDPOINTS = {
    "profile": ("/user/profile", None, "Current account profile"),
    "preferences": ("/user/preferences", None, "Account preferences"),
    "countries": ("/countries", None, "Country list"),
    "whitelabel-settings": ("/whitelabel-settings", None, "White-label configuration"),
    "device-profile": ("/device/profile/{id}", "device", "Child/watch profile"),
    "call-logs": ("/calllogging/{id}", "device", "Watch call logs"),
    "contacts": ("/contact", None, "Contacts"),
    "emergency-contact": ("/contact/emergency", None, "Emergency contact"),
    "friends": ("/friends", None, "Pending friends"),
    "alarms": ("/alarms", None, "Alarms"),
    "all-alarms": ("/alarms/all", None, "All alarms"),
    "steps": ("/stepcounter", None, "Step leaderboard"),
    "goals": ("/device/goals/{id}", "device", "Watch step goal"),
    "heartrate": ("/heartrate", None, "Heart rate summary"),
    "sleep": ("/sleepmonitor", None, "Sleep summary"),
    "todos": ("/todo", None, "Todos"),
    "chats": ("/tokk", None, "Chat roster"),
    "device-messages": ("/tokk/device/{id}/messages", "device", "Watch conversation"),
    "user-messages": ("/tokk/user/{id}/messages", "user", "User conversation"),
    "group-messages": ("/tokk/group/{id}/messages", "group", "Group conversation"),
    "user-image": ("/user/image", None, "Account image"),
    "device-image": ("/device/image/{id}", "device", "Child/watch image"),
    "contact-image": ("/contact/image/{id}", "contact", "Contact avatar"),
    "safe-zones": ("/safezones", None, "Configured safe zones"),
    "notifications": ("/eventlogs", None, "Stored notification history"),
}
IMAGE_COMMANDS = {"user-image", "device-image", "contact-image"}

# Named DELETE routes for resources created by the CLI. IDs are schedule/zone
# IDs from list responses, never defaulted from COSMO_DEVICE_ID.
DELETE_ENDPOINTS = {
    "delete-safe-zone": ("/safezones/{id}", "safe-zone", "safe-zones"),
    "delete-focus-mode": ("/alarms/{id}", "alarm schedule", "alarms"),
}
EP_ALARM_UPDATE = "/alarms/{id}"
EP_DEVICE_UNREGISTER = "/device/unregister"
ALARM_WRITE_FIELDS = {
    "title": "Name", "message": "Message", "enabled": "Enabled",
    "time": "Time", "endTime": "EndTime", "weekDays": "WeekDays",
    "schoolMode": "SchoolMode", "focusMode": "focusMode", "lockdown": "Lockdown",
    "owning": "owning", "silentMode": "silentMode", "snooze": "Snooze", "type": "Type",
    "date": "Date", "allowedToSee": "allowedToSee",
}


class CosmoAuthError(Exception):
    """Invalid credentials / unrecoverable auth failure."""


class CosmoApiError(Exception):
    """Non-auth API failure."""


class CosmoPermissionError(CosmoApiError):
    """The server denied access to this resource (HTTP/API 403)."""


def utc_offset_hours() -> int:
    off = datetime.now(timezone.utc).astimezone().utcoffset()
    return int(off.total_seconds() // 3600) if off else 0


class CosmoClient:
    """Holds tokens (cached to .tokens.json between runs) and talks to FiLIP."""

    def __init__(self, email: str, password: str, *, verbose: bool = False) -> None:
        self.email = email
        self.password = password
        self.verbose = verbose
        self.session = requests.Session()
        self.access: str | None = None
        self.refresh: str | None = None
        self.exp: datetime | None = None
        self._load_cache()

    # --- token cache ----------------------------------------------------------

    def _load_cache(self) -> None:
        try:
            data = json.loads(TOKEN_CACHE.read_text())
        except (OSError, ValueError):
            return
        if data.get("email") != self.email:
            return
        self.access = data.get("accessToken")
        self.refresh = data.get("refreshToken")
        if data.get("expDate"):
            self.exp = datetime.fromisoformat(data["expDate"])

    def _save_cache(self) -> None:
        require_private_path(TOKEN_CACHE)
        TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_CACHE.write_text(
            json.dumps(
                {
                    "email": self.email,
                    "accessToken": self.access,
                    "refreshToken": self.refresh,
                    "expDate": self.exp.isoformat() if self.exp else None,
                },
                indent=2,
            )
        )

    # --- auth -----------------------------------------------------------------

    def login(self) -> dict[str, Any]:
        data = self.request(
            "POST",
            EP_TOKEN,
            json_body={
                "appBuild": APP_BUILD,
                "email": self.email,
                "password": self.password,
                "whiteLabelId": WHITE_LABEL_ID,
            },
            auth=False,
        )
        self._store_tokens(data)
        return data

    def refresh_token(self) -> None:
        if not self.refresh:
            self.login()
            return
        try:
            data = self.request(
                "POST", EP_TOKEN_REFRESH, json_body={"refreshToken": self.refresh}, auth=False
            )
            self._store_tokens(data)
        except (CosmoAuthError, CosmoApiError) as err:
            self._log(f"refresh failed ({err}); logging in again")
            self.login()

    def _store_tokens(self, payload: Any) -> None:
        data = payload.get("data", payload) if isinstance(payload, dict) else {}
        self.access = data.get("accessToken")
        self.refresh = data.get("refreshToken")
        exp = data.get("expDate")
        self.exp = datetime.fromisoformat(exp.replace("Z", "+00:00")) if exp else None
        if not self.access:
            raise CosmoAuthError("login/refresh returned no accessToken")
        self._save_cache()

    def ensure_token(self) -> None:
        if self.access is None:
            self.login()
        elif self.exp and datetime.now(timezone.utc) >= self.exp - TOKEN_REFRESH_MARGIN:
            self.refresh_token()

    # --- data -----------------------------------------------------------------

    def get_map(self) -> Any:
        return self.request("GET", EP_MAP)

    def get_devices(self) -> list[dict[str, Any]]:
        body = self.get_map()
        data = body.get("data") if isinstance(body, dict) else None
        devices = data.get("Devices") if isinstance(data, dict) else None
        if not isinstance(devices, list) or any(not isinstance(device, dict) for device in devices):
            raise CosmoApiError("map returned an unsupported device list")
        try:
            for device in devices:
                numeric_resource_id(device.get("id"), "watch")
        except ValueError as err:
            raise CosmoApiError("map returned a device without a valid watch id") from err
        return devices

    def get_device(self, device_id: int | str) -> dict[str, Any] | None:
        for d in self.get_devices():
            if str(d.get("id")) == str(device_id):
                return d
        return None

    def get_resource(self, name: str, resource_id: int | str | None = None) -> Any:
        """Read a documented resource; image resources return bytes or JSON."""
        if name not in READ_ENDPOINTS:
            raise ValueError(f"Unknown read resource: {name}")
        path, id_kind, _ = READ_ENDPOINTS[name]
        if id_kind:
            if resource_id is None or not str(resource_id).isdigit():
                raise ValueError(f"{name} requires a numeric {id_kind} id")
            path = path.format(id=quote(str(resource_id), safe=""))
        elif resource_id is not None:
            raise ValueError(f"{name} does not take an id")
        return self.request("GET", path, binary=name in IMAGE_COMMANDS)

    def get_daily_steps(self, device_id: int | str, start_date: str, end_date: str) -> Any:
        """Query saved daily totals; does not request a watch sync."""
        if not str(device_id).isascii() or not str(device_id).isdigit():
            raise ValueError("daily-steps requires a numeric watch id")
        try:
            start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
        except ValueError as err:
            raise ValueError("dates must use YYYY-MM-DD") from err
        if start.isoformat() != start_date or end.isoformat() != end_date:
            raise ValueError("dates must use YYYY-MM-DD")
        if not 0 < (end - start).days <= 31:
            raise ValueError("date range must be increasing and at most 31 days")
        return self.request(
            "POST", "/stepcounter/list/daily/simple/{id}".format(id=str(device_id)),
            json_body={"startDate": start_date, "endDate": end_date},
        )

    def download_chat_attachment(self, url: str, *, _retried: bool = False) -> tuple[bytes, str]:
        """Fetch an audio/image URL returned by the chat API.

        API-hosted attachments use the account bearer token.
        For a separate HTTPS host (for example, a signed object-store URL), this
        intentionally makes an unauthenticated request so a chat message cannot
        cause the account token to be disclosed to an arbitrary server.
        """
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("chat attachment URL must be an absolute HTTPS URL without credentials")
        api_host = urlsplit(API_BASE).netloc
        authenticated = parsed.netloc == api_host
        if authenticated:
            self.ensure_token()
        headers = {"x-accept-version": "1.0"}
        if authenticated and self.access:
            headers["Authorization"] = f"Bearer {self.access}"
        try:
            response = self.session.request(
                "GET", url, headers=headers, timeout=30, allow_redirects=False
            )
        except requests.RequestException as err:
            raise CosmoApiError(f"attachment download failed: {err}") from err
        if response.status_code == 401 and authenticated and not _retried:
            self._log("attachment auth rejected; logging in again and retrying")
            self.login()
            return self.download_chat_attachment(url, _retried=True)
        if response.status_code >= 400:
            raise CosmoApiError(f"attachment download returned HTTP {response.status_code}")
        if 300 <= response.status_code < 400:
            raise CosmoApiError(f"attachment download returned unexpected redirect {response.status_code}")
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if not response.content or content_type in {"", "text/html", "application/json", "text/plain"}:
            raise CosmoApiError(f"attachment download returned unexpected content type: {content_type or 'missing'}")
        return response.content, content_type

    def set_active_tracking(
        self, device_id: int | str, enable: bool, duration: int, frequency: int
    ) -> Any:
        """Turbo mode: wake the watch to report frequently (or stop)."""
        if not str(device_id).isascii() or not str(device_id).isdigit():
            raise ValueError("tracking requires a numeric watch id")
        return self.request(
            "PUT",
            f"/settings/{device_id}",
            json_body={
                "activeTrackingDuration": duration,
                "activeTrackingEnable": enable,
                "activeTrackingFrequency": frequency,
            },
        )

    # --- transport ------------------------------------------------------------

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: dict[str, Any] | None = None,
        binary: bool = False,
        auth: bool = True,
        retry_auth: bool = True,
        _retried: bool = False,
    ) -> Any:
        # Accept Swagger's /v2 paths without accidentally requesting /v2/v2.
        if path.startswith(("http://", "https://")):
            url = path
        elif path.lstrip("/").startswith("v2/"):
            url = API_BASE.removesuffix("/v2") + "/" + path.lstrip("/")
        else:
            url = API_BASE + "/" + path.lstrip("/")
        if auth and (urlsplit(url).scheme, urlsplit(url).netloc) != (
            urlsplit(API_BASE).scheme, urlsplit(API_BASE).netloc
        ):
            raise CosmoApiError("Authenticated requests must use the FiLIP API host")
        if auth:
            self.ensure_token()
        headers = {
            "x-accept-version": "1.0",
            "x-accept-offset": str(utc_offset_hours()),
            "Content-Type": "application/json; charset=UTF-8",
        }
        if auth and self.access:
            headers["Authorization"] = f"Bearer {self.access}"

        self._log(f"> {method} {url}")
        try:
            resp = self.session.request(
                method, url, json=json_body, params=params, headers=headers,
                timeout=30, allow_redirects=False,
            )
        except requests.RequestException as err:
            raise CosmoApiError(f"{method} {url} failed: {err}") from err
        self._log(f"< {resp.status_code} ({len(resp.content)} bytes)")

        try:
            if resp.status_code == 401:
                raise CosmoAuthError(f"{method} {url} -> {resp.status_code}")
            if resp.status_code == 403:
                hint = " Use the matching conversation id from `chats`." if "/tokk/" in url else ""
                raise CosmoPermissionError(f"{method} {url} -> 403: access forbidden for this resource.{hint}")
            if resp.status_code >= 400:
                raise CosmoApiError(f"{method} {url} -> {resp.status_code}: {resp.text[:500]}")
            if 300 <= resp.status_code < 400:
                raise CosmoApiError(f"{method} {url} -> unexpected redirect {resp.status_code}")
            try:
                body = resp.json() if resp.content else {}
            except ValueError as err:
                if binary:
                    content_type = resp.headers.get("Content-Type", "").split(";", 1)[0].lower()
                    if content_type.startswith("image/") or content_type == "application/octet-stream":
                        return resp.content
                    raise CosmoApiError(f"{method} {url} returned unexpected image content type: {content_type}") from err
                raise CosmoApiError(f"{method} {url} returned non-JSON data") from err
            # FiLIP signals expired tokens with status 2 in a 200 envelope.
            if isinstance(body, dict) and body.get("status") == 2:
                raise CosmoAuthError(body.get("message", "token expired"))
            if isinstance(body, dict) and body.get("status") == 403:
                raise CosmoPermissionError(f"{method} {url} -> API status 403: access forbidden for this resource")
            if isinstance(body, dict) and isinstance(body.get("status"), int) and body["status"] >= 400:
                raise CosmoApiError(f"{method} {url} -> API status {body['status']}: {body.get('message', '')}")
            return body
        except CosmoAuthError:
            # A cached token may have been revoked server-side: re-login once.
            if auth and retry_auth and not _retried:
                self._log("auth rejected; logging in again and retrying")
                self.login()
                return self.request(
                    method, path, json_body=json_body, params=params, binary=binary,
                    auth=auth, retry_auth=retry_auth, _retried=True,
                )
            raise

    def _log(self, msg: str) -> None:
        if self.verbose:
            print(msg, file=sys.stderr)


# --- helpers ----------------------------------------------------------------


def reverse_geocode(lat: float, lon: float) -> str | None:
    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 18},
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("display_name")
    except (requests.RequestException, ValueError):
        return None


def save_capture(name: str, data: Any) -> Path:
    require_private_path(CAPTURE_DIR)
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name).strip("_")
    path = CAPTURE_DIR / f"{stamp}_{safe}.json"
    path.write_text(json.dumps(data, indent=2))
    return path


def write_json_new(path: Path, data: Any) -> None:
    """Write a UTF-8 JSON file, never replacing an existing backup artifact."""
    with path.open("x", encoding="utf-8") as output:
        json.dump(data, output, indent=2, ensure_ascii=False)
        output.write("\n")


def require_private_path(path: Path) -> None:
    if path.expanduser().resolve().is_relative_to(ROOT.parent):
        raise ValueError("personal data must be stored outside the repository")


def attachment_suffix(url: str, content_type: str) -> str:
    """Choose a harmless extension for a downloaded attachment."""
    guessed = Path(urlsplit(url).path).suffix.lower()
    if guessed and len(guessed) <= 10 and guessed[1:].isalnum():
        return guessed
    return mimetypes.guess_extension(content_type) or ".bin"


def emit(args: argparse.Namespace, name: str, data: Any) -> None:
    print(json.dumps(data, indent=2))
    if args.save:
        print(f"saved -> {save_capture(name, data)}", file=sys.stderr)


def resolve_device_id(client: CosmoClient, given: str | None) -> str:
    selected = given or os.environ.get("COSMO_DEVICE_ID")
    if selected:
        if not str(selected).isascii() or not str(selected).isdigit():
            raise ValueError("provide a numeric watch id")
        return str(selected)
    devices = client.get_devices()
    if len(devices) == 1:
        return str(devices[0]["id"])
    names = ", ".join(f"{d['id']} ({d.get('firstName')})" for d in devices) or "none"
    sys.exit(f"Multiple/no watches on account; pass a device id. Found: {names}")


def wait_for_fresh_fixes(
    client: CosmoClient, last_fixes: dict[str, str | None]
) -> tuple[dict[str, dict[str, Any]], set[str]]:
    """Poll /map until each device's gpsDate moves past last_fixes (~2 min max).

    Returns the latest record per device and the ids that got a fresh fix.
    """
    latest: dict[str, dict[str, Any]] = {}
    fresh: set[str] = set()
    waited = 0
    for delay in POLL_DELAYS:
        time.sleep(delay)
        waited += delay
        for d in client.get_devices():
            did = str(d.get("id"))
            if did not in last_fixes or did in fresh:
                continue
            latest[did] = d
            fix = d.get("gpsDate")
            print(
                f"  +{waited:>3}s  {did}  fix={fix}  lat/lon={d.get('latitude')},{d.get('longitude')}",
                file=sys.stderr,
            )
            if fix and fix != last_fixes[did]:
                fresh.add(did)
        if fresh == set(last_fixes):
            break
    for did in sorted(set(last_fixes) - fresh):
        print(f"{did}: no new fix within ~2 minutes (watch may be off or out of signal).", file=sys.stderr)
    return latest, fresh


# --- commands -----------------------------------------------------------------


def cmd_login(client: CosmoClient, args: argparse.Namespace) -> None:
    client.login()
    print(f"Logged in. Access token expires {client.exp}")


def cmd_devices(client: CosmoClient, args: argparse.Namespace) -> None:
    devices = client.get_devices()
    if args.save:
        save_capture("devices", devices)
    if not devices:
        print("No watches on this account.")
        return
    for d in devices:
        print(
            f"{d.get('id'):>10}  {d.get('firstName') or '?':<12} "
            f"model={d.get('hardwareName')}  battery={d.get('batteryLevel')}%  "
            f"fix={d.get('gpsDate')}  lat/lon={d.get('latitude')},{d.get('longitude')}"
        )


def cmd_map(client: CosmoClient, args: argparse.Namespace) -> None:
    emit(args, "map", client.get_map())


def cmd_read(client: CosmoClient, args: argparse.Namespace) -> None:
    if args.command in IMAGE_COMMANDS:
        require_private_path(Path(args.output))
    _, id_kind, _ = READ_ENDPOINTS[args.command]
    resource_id = getattr(args, "resource_id", None)
    if id_kind == "device":
        resource_id = resolve_device_id(client, resource_id)
    if args.command in {"device-messages", "user-messages", "group-messages"}:
        if resource_id is None or not str(resource_id).isascii() or not str(resource_id).isdigit():
            raise ValueError(f"{args.command} requires a numeric {id_kind} conversation id from `chats`")
        roster = client.get_resource("chats")
        entries = roster.get("data", {}).get(id_kind + "s", [])
        if not any(str(entry.get("id")) == str(resource_id) for entry in entries):
            raise ValueError(
                f"This id is not listed under data.{id_kind}s in `chats`. "
                f"Run `python cosmo.py chats` and use a {id_kind} conversation id from that list. "
                "Profile, contact, and conversation ids are not interchangeable."
            )
    data = client.get_resource(args.command, resource_id)
    if isinstance(data, bytes):
        # Exclusive creation prevents replacing an existing file by mistake.
        with Path(args.output).open("xb") as output:
            output.write(data)
        print(f"saved image -> {args.output} ({len(data)} bytes)", file=sys.stderr)
    else:
        emit(args, args.command, data)


def cmd_backup_chats(client: CosmoClient, args: argparse.Namespace) -> None:
    """Create a read-only, self-describing snapshot of every rostered chat."""
    destination = Path(args.output_dir)
    require_private_path(destination)
    if destination.exists():
        raise FileExistsError(f"backup destination already exists: {destination}")

    roster = client.get_resource("chats")
    if not isinstance(roster, dict):
        raise CosmoApiError("chat roster returned an unexpected response")
    chat_lists = roster.get("data", {})
    if not isinstance(chat_lists, dict):
        raise CosmoApiError("chat roster has no data object")

    destination.mkdir(parents=True)
    conversations_dir = destination / "conversations"
    conversations_dir.mkdir()
    write_json_new(destination / "roster.json", roster)
    manifest: dict[str, Any] = {
        "format": "cosmo-chat-backup-v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "roster": "roster.json",
        "conversations": [],
        "attachments": [],
    }

    for kind in ("device", "user", "group"):
        entries = chat_lists.get(kind + "s", [])
        if not isinstance(entries, list):
            continue
        for entry in entries:
            conversation: dict[str, Any] = {"kind": kind, "id": entry.get("id") if isinstance(entry, dict) else None}
            resource_id = conversation["id"]
            if not isinstance(resource_id, int) and not (isinstance(resource_id, str) and resource_id.isdigit()):
                conversation["error"] = "roster entry has no numeric conversation id"
                manifest["conversations"].append(conversation)
                continue
            filename = f"{kind}-{resource_id}.json"
            try:
                messages = client.get_resource(f"{kind}-messages", resource_id)
                write_json_new(conversations_dir / filename, messages)
                conversation["file"] = f"conversations/{filename}"
                message_list = messages.get("data", []) if isinstance(messages, dict) else []
                if not isinstance(message_list, list):
                    message_list = []
                conversation["messageCount"] = len(message_list)
            except (CosmoApiError, OSError, ValueError) as err:
                conversation["error"] = str(err)
                manifest["conversations"].append(conversation)
                continue
            manifest["conversations"].append(conversation)

            for position, message in enumerate(message_list):
                if not isinstance(message, dict):
                    continue
                try:
                    message_type = int(message.get("messageType"))
                except (TypeError, ValueError):
                    continue
                url = message.get("data")
                if message_type not in CHAT_MEDIA_TYPES or not isinstance(url, str):
                    continue
                attachment: dict[str, Any] = {
                    "conversation": f"{kind}-{resource_id}",
                    "messageId": message.get("messageId"),
                    "messageType": message_type,
                }
                try:
                    payload, content_type = client.download_chat_attachment(url)
                    digest = hashlib.sha256(payload).hexdigest()
                    media_dir = destination / "media" / f"{kind}-{resource_id}"
                    media_dir.mkdir(parents=True, exist_ok=True)
                    suffix = attachment_suffix(url, content_type)
                    message_id = str(message.get("messageId", "unknown"))
                    safe_message_id = message_id if message_id.isascii() and message_id.isdigit() else "unknown"
                    media_name = f"{position:05}-{safe_message_id}-{digest[:12]}{suffix}"
                    media_path = media_dir / media_name
                    with media_path.open("xb") as output:
                        output.write(payload)
                    attachment.update(
                        {
                            "file": str(media_path.relative_to(destination)).replace("\\", "/"),
                            "contentType": content_type,
                            "bytes": len(payload),
                            "sha256": digest,
                        }
                    )
                except (CosmoApiError, OSError, ValueError) as err:
                    attachment["error"] = str(err)
                manifest["attachments"].append(attachment)

    write_json_new(destination / "manifest.json", manifest)
    failed_conversations = sum("error" in item for item in manifest["conversations"])
    failed_attachments = sum("error" in item for item in manifest["attachments"])
    print(
        f"Chat backup saved to {destination} ({len(manifest['conversations'])} conversations, "
        f"{len(manifest['attachments'])} attachments; {failed_conversations} conversation and "
        f"{failed_attachments} attachment failures)."
    )


def cmd_send_message(client: CosmoClient, args: argparse.Namespace) -> None:
    """Send a text message through the device-chat route."""
    if not args.yes:
        raise ValueError("send-message changes a real conversation; re-run with --yes")
    device_id = resolve_device_id(client, args.device_id)
    roster = client.get_resource("chats")
    devices = roster.get("data", {}).get("devices", []) if isinstance(roster, dict) else []
    if not any(str(entry.get("id")) == str(device_id) for entry in devices if isinstance(entry, dict)):
        raise ValueError("device id is not listed under data.devices in `chats`")
    response = client.request(
        "POST", f"/tokk/device/{device_id}/message",
        json_body={"messageType": 1, "data": args.message},
    )
    emit(args, "send-message", response)


def build_safe_zone_body(
    name: str, latitude: float, longitude: float, radius: float, device_ids: list[str]
) -> dict[str, Any]:
    """Build an enabled safe zone with notifications enabled."""
    if not name.strip():
        raise ValueError("safe-zone name cannot be empty")
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError("latitude or longitude is outside its valid range")
    if not SAFE_ZONE_MIN_RADIUS <= radius <= SAFE_ZONE_MAX_RADIUS:
        raise ValueError(
            f"safe-zone radius must be between {SAFE_ZONE_MIN_RADIUS} and {SAFE_ZONE_MAX_RADIUS} meters"
        )
    if not device_ids or any(not device_id.isascii() or not device_id.isdigit() for device_id in device_ids):
        raise ValueError("provide one or more numeric --device ids")
    if len(set(device_ids)) != len(device_ids):
        raise ValueError("each --device id must be supplied only once")

    return {
        "name": name.strip(),
        "latitude": str(latitude),
        "longitude": str(longitude),
        "radius": radius,
        "enabled": True,
        "type": 0,
        "devices": [
            {
                "deviceId": int(device_id),
                "enable": True,
                "silent": False,
                "silentDays": [1, 2, 3, 4, 5, 6, 7],
            }
            for device_id in device_ids
        ],
    }


def cmd_create_safe_zone(client: CosmoClient, args: argparse.Namespace) -> None:
    """Create an enabled safe zone."""
    if not args.yes:
        raise ValueError("create-safe-zone changes real watch settings; re-run with --yes")
    body = build_safe_zone_body(args.name, args.latitude, args.longitude, args.radius, args.device)
    emit(args, "create-safe-zone", client.request("POST", "/safezones", json_body=body))


def time_of_day_seconds(value: str) -> int:
    """Return seconds since local midnight for an HH:MM schedule time."""
    try:
        parsed = datetime.strptime(value, "%H:%M")
    except ValueError as err:
        raise ValueError("time must use 24-hour HH:MM format") from err
    return (parsed.hour * 60 + parsed.minute) * 60


def parse_week_days(value: str) -> list[bool]:
    """Convert comma-separated day names into a Monday-first array."""
    names = [part.strip().lower() for part in value.split(",") if part.strip()]
    if not names:
        raise ValueError("provide one or more days, such as mon,tue,wed")
    unknown = [name for name in names if name not in WEEKDAY_NAMES]
    if unknown:
        raise ValueError("unrecognized day: " + ", ".join(unknown))
    indexes = [WEEKDAY_NAMES[name] for name in names]
    if len(set(indexes)) != len(indexes):
        raise ValueError("each day may be supplied only once")
    return [index in indexes for index in range(7)]


def build_focus_mode_body(
    name: str, start_time: str, end_time: str, device_ids: list[str], week_days: list[bool],
    lockdown: bool = False,
) -> dict[str, Any]:
    """Build a Focus Mode schedule body."""
    if not name.strip():
        raise ValueError("focus-mode name cannot be empty")
    start_seconds = time_of_day_seconds(start_time)
    end_seconds = time_of_day_seconds(end_time)
    if end_seconds <= start_seconds:
        raise ValueError("focus-mode end time must be after its start time")
    if not device_ids or any(not device_id.isascii() or not device_id.isdigit() for device_id in device_ids):
        raise ValueError("provide one or more numeric --device ids")
    if len(set(device_ids)) != len(device_ids):
        raise ValueError("each --device id must be supplied only once")
    if len(week_days) != 7 or not any(week_days):
        raise ValueError("focus mode must select at least one of the seven days")

    # Focus Mode uses the SchoolMode schedule field.
    # Lockdown defaults to false: calls/messages to the primary
    # account holder remain allowed while the scheduled focus mode is active.
    return {
        "Devices": [int(device_id) for device_id in device_ids],
        "Enabled": True,
        "EndTime": end_seconds,
        "focusMode": False,
        "Lockdown": lockdown,
        "Message": name.strip(),
        "Name": name.strip(),
        "owning": True,
        "SchoolMode": True,
        "silentMode": False,
        "Time": start_seconds,
        "Type": 4,
        "WeekDays": week_days,
    }


def cmd_create_focus_mode(client: CosmoClient, args: argparse.Namespace) -> None:
    """Create a weekday Focus Mode schedule through the alarms route."""
    if not args.yes:
        raise ValueError("create-focus-mode changes real watch settings; re-run with --yes")
    body = build_focus_mode_body(
        args.name, args.start_time, args.end_time, args.device, parse_week_days(args.days),
        lockdown=args.lockdown,
    )
    emit(args, "create-focus-mode", client.request("POST", "/alarms", json_body=body))


def cmd_delete(client: CosmoClient, args: argparse.Namespace) -> None:
    """Delete a selected safe zone or Focus Mode schedule by its resource ID."""
    if not args.yes:
        raise ValueError(f"{args.command} changes real watch settings; re-run with --yes")
    path, resource_kind, list_command = DELETE_ENDPOINTS[args.command]
    resource_id = args.resource_id
    if not resource_id.isascii() or not resource_id.isdigit():
        raise ValueError(f"provide a numeric {resource_kind} id from `{list_command}`")
    emit(args, args.command, client.request("DELETE", path.format(id=resource_id)))


def numeric_resource_id(value: Any, kind: str) -> int:
    text = str(value)
    if not text.isascii() or not text.isdigit() or not 0 < int(text) <= 2147483647:
        raise ValueError(f"provide a positive 32-bit numeric {kind} id")
    return int(text)


def find_focus_mode(client: CosmoClient, resource_id: int) -> dict[str, Any]:
    response = client.get_resource("alarms")
    schedules = response.get("data") if isinstance(response, dict) else None
    if not isinstance(schedules, list) or any(not isinstance(item, dict) for item in schedules):
        raise ValueError("alarms returned an unsupported schedule list")
    matches = [item for item in schedules if str(item.get("Id", item.get("id"))) == str(resource_id)]
    if len(matches) != 1:
        raise ValueError("schedule id must identify exactly one entry in `alarms`")
    schedule = matches[0]
    if schedule.get("schoolMode") is not True and schedule.get("focusMode") is not True:
        raise ValueError("selected alarm is not a Focus Mode schedule")
    return schedule


def focus_mode_update_body(schedule: dict[str, Any], resource_id: int) -> dict[str, Any]:
    """Translate a complete schedule read without inventing retained settings."""
    required = set(ALARM_WRITE_FIELDS) - {"date", "allowedToSee", "message"}
    missing = sorted(required - schedule.keys())
    if missing:
        raise ValueError("schedule cannot be safely updated; missing fields: " + ", ".join(missing))
    for field in ("enabled", "schoolMode", "focusMode", "lockdown", "owning", "silentMode", "snooze"):
        if not isinstance(schedule[field], bool):
            raise ValueError(f"schedule has an unsupported {field} value")
    if not isinstance(schedule["title"], str) or not schedule["title"].strip():
        raise ValueError("schedule has an unsupported title")
    for field in ("time", "endTime"):
        if type(schedule[field]) is not int or not 0 <= schedule[field] < 86400:
            raise ValueError(f"schedule has an unsupported {field} value")
    days = schedule["weekDays"]
    if not isinstance(days, list) or len(days) != 7 or any(type(day) is not bool for day in days):
        raise ValueError("schedule has unsupported weekDays")
    if type(schedule["type"]) is not int:
        raise ValueError("schedule has an unsupported type")
    for field in ("message", "date"):
        if schedule.get(field) is not None and not isinstance(schedule[field], str):
            raise ValueError(f"schedule has an unsupported {field} value")
    if schedule.get("allowedToSee") is not None and not isinstance(schedule["allowedToSee"], bool):
        raise ValueError("schedule has an unsupported allowedToSee value")
    devices = schedule.get("devices")
    if not isinstance(devices, list) or any(not isinstance(device, dict) for device in devices):
        raise ValueError("schedule has unsupported device assignments")
    device_ids = [numeric_resource_id(device.get("id"), "watch") for device in devices]
    if len(device_ids) != len(set(device_ids)):
        raise ValueError("schedule has duplicate device assignments")
    body = {write: schedule[read] for read, write in ALARM_WRITE_FIELDS.items() if read in schedule}
    body.update({"Id": resource_id, "Devices": device_ids})
    return body


def request_confirmed_mutation(client: CosmoClient, method: str, path: str, body: dict[str, Any]) -> Any:
    try:
        return client.request(method, path, json_body=body, retry_auth=False)
    except (CosmoApiError, CosmoAuthError) as err:
        raise CosmoApiError(
            f"Mutation was not retried: {err}. Read current state before trying again; "
            "a lost response can leave the outcome unknown."
        ) from err


def cmd_update_focus_mode(client: CosmoClient, args: argparse.Namespace) -> None:
    if not args.dry_run and not args.yes:
        raise ValueError("update-focus-mode changes real watch settings; re-run with --yes or --dry-run")
    resource_id = numeric_resource_id(args.resource_id, "schedule")
    remove_ids = [numeric_resource_id(value, "watch") for value in args.remove_device]
    if len(remove_ids) != len(set(remove_ids)):
        raise ValueError("each --remove-device id must be supplied only once")
    if args.enabled is None and not remove_ids:
        raise ValueError("select --enable, --disable, or --remove-device")
    body = focus_mode_update_body(find_focus_mode(client, resource_id), resource_id)
    if any(value not in body["Devices"] for value in remove_ids):
        raise ValueError("a --remove-device watch is not assigned to the schedule")
    body["Devices"] = [value for value in body["Devices"] if value not in remove_ids]
    if not body["Devices"]:
        raise ValueError("cannot leave a schedule without watches; use delete-focus-mode instead")
    if args.enabled is not None:
        body["Enabled"] = args.enabled
    path = EP_ALARM_UPDATE.format(id=resource_id)
    if args.dry_run:
        emit(args, args.command, {"method": "PUT", "path": "/v2" + path, "body": body, "dryRun": True})
        return
    result = request_confirmed_mutation(client, "PUT", path, body)
    try:
        persisted = focus_mode_update_body(find_focus_mode(client, resource_id), resource_id)
        settings_match = all(persisted.get(key) == value for key, value in body.items() if key != "Devices")
        if not settings_match or set(persisted["Devices"]) != set(body["Devices"]):
            raise ValueError("returned schedule differs from the requested settings")
    except (ValueError, CosmoApiError, CosmoAuthError) as err:
        raise CosmoApiError(f"Update was sent but readback could not verify it: {err}. Do not blindly retry.") from err
    emit(args, args.command, result)


def cmd_unregister_device(client: CosmoClient, args: argparse.Namespace) -> None:
    if not args.dry_run and not args.yes:
        raise ValueError("unregister-device removes a real watch; re-run with --yes or --dry-run")
    device_id = numeric_resource_id(args.device_id, "watch")
    if client.get_device(device_id) is None:
        raise ValueError("watch id is not listed on this account in `devices`")
    body = {"deviceId": device_id, "deleteEsim": args.delete_esim}
    if args.dry_run:
        emit(args, args.command, {"method": "POST", "path": "/v2" + EP_DEVICE_UNREGISTER, "body": body, "dryRun": True})
        return
    result = request_confirmed_mutation(client, "POST", EP_DEVICE_UNREGISTER, body)
    try:
        if client.get_device(device_id) is not None:
            raise ValueError("watch remains listed on this account")
    except (ValueError, CosmoApiError, CosmoAuthError) as err:
        raise CosmoApiError(f"Unregistration was sent but readback could not verify it: {err}. Do not blindly retry.") from err
    emit(args, args.command, result)


def cmd_device(client: CosmoClient, args: argparse.Namespace) -> None:
    if args.turbo and not args.yes:
        raise ValueError("device --turbo changes real watch settings; re-run with --yes")
    # Unlike locate/stop this is read-only, so with no id it covers every watch.
    devices = client.get_devices()
    device_id = args.device_id or os.environ.get("COSMO_DEVICE_ID")
    if device_id:
        devices = [d for d in devices if str(d.get("id")) == str(device_id)]
        if not devices:
            sys.exit(f"Device {device_id} not found on account")
    elif not devices:
        sys.exit("No watches on this account.")
    if args.turbo:
        last_fixes = {str(d.get("id")): d.get("gpsDate") for d in devices}
        for did in last_fixes:
            client.set_active_tracking(
                did, enable=True, duration=ACTIVE_TRACKING_DURATION, frequency=ACTIVE_TRACKING_FREQUENCY
            )
        print(
            f"Active tracking enabled on {', '.join(last_fixes)} "
            f"({ACTIVE_TRACKING_DURATION}s @ every {ACTIVE_TRACKING_FREQUENCY}s); waiting for fresh fixes...",
            file=sys.stderr,
        )
        latest, _ = wait_for_fresh_fixes(client, last_fixes)
        devices = [latest.get(str(d.get("id")), d) for d in devices]
    for device in devices:
        if len(devices) > 1:
            print(f"\n=== {device.get('id')} ({device.get('firstName')}) ===", file=sys.stderr)
        emit(args, f"device_{device.get('id')}", device)
        if not args.no_geocode and device.get("latitude") is not None:
            addr = reverse_geocode(device["latitude"], device["longitude"])
            print(f"\nAddress: {addr or '(lookup failed)'}", file=sys.stderr)


def cmd_locate(client: CosmoClient, args: argparse.Namespace) -> None:
    if not args.yes:
        raise ValueError("locate changes real watch settings; re-run with --yes")
    device_id = resolve_device_id(client, args.device_id)
    before = client.get_device(device_id) or {}
    last_fix = before.get("gpsDate")
    print(f"Current fix: {last_fix} @ {before.get('latitude')},{before.get('longitude')}")

    resp = client.set_active_tracking(
        device_id, enable=True, duration=args.duration, frequency=args.frequency
    )
    print(f"Active tracking enabled ({args.duration}s @ every {args.frequency}s).")
    if args.verbose:
        print(json.dumps(resp, indent=2), file=sys.stderr)
    if args.no_wait:
        return

    latest, fresh = wait_for_fresh_fixes(client, {str(device_id): last_fix})
    if str(device_id) in fresh:
        d = latest[str(device_id)]
        print("Fresh fix received.")
        addr = reverse_geocode(d["latitude"], d["longitude"])
        if addr:
            print(f"Address: {addr}")


def cmd_stop(client: CosmoClient, args: argparse.Namespace) -> None:
    if not args.yes:
        raise ValueError("stop changes real watch settings; re-run with --yes")
    device_id = resolve_device_id(client, args.device_id)
    client.set_active_tracking(device_id, enable=False, duration=0, frequency=args.frequency)
    print("Active tracking disabled.")


def cmd_daily_steps(client: CosmoClient, args: argparse.Namespace) -> None:
    # Validate dates before even reading the account to resolve a watch.
    try:
        start, end = date.fromisoformat(args.start_date), date.fromisoformat(args.end_date)
    except ValueError as err:
        raise ValueError("dates must use YYYY-MM-DD") from err
    if start.isoformat() != args.start_date or end.isoformat() != args.end_date:
        raise ValueError("dates must use YYYY-MM-DD")
    if not 0 < (end - start).days <= 31:
        raise ValueError("date range must be increasing and at most 31 days")
    device_id = resolve_device_id(client, args.device_id)
    emit(args, "daily-steps", client.get_daily_steps(device_id, args.start_date, args.end_date))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-v", "--verbose", action="store_true", help="log requests to stderr")
    p.add_argument("--save", action="store_true", help="save JSON responses in the external data directory")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("login", help="force a fresh login").set_defaults(func=cmd_login)
    sub.add_parser("devices", help="list watches on the account").set_defaults(func=cmd_devices)
    sub.add_parser("map", help="dump the full GET /v2/map response").set_defaults(func=cmd_map)
    s = sub.add_parser("daily-steps", help="query stored daily steps (read-only POST; no watch sync)")
    s.add_argument("device_id", nargs="?")
    s.add_argument("--from", dest="start_date", required=True, help="start calendar date, YYYY-MM-DD")
    s.add_argument("--to", dest="end_date", required=True, help="end calendar date, YYYY-MM-DD; at most 31 days")
    s.set_defaults(func=cmd_daily_steps)
    s = sub.add_parser("backup-chats", help="save all rostered chat history and available media (read-only)")
    s.add_argument(
        "output_dir",
        help="new destination directory; it must not already exist",
    )
    s.set_defaults(func=cmd_backup_chats)
    for name, (_, id_kind, help_text) in READ_ENDPOINTS.items():
        s = sub.add_parser(name, help=help_text + " (read-only)")
        if id_kind:
            s.add_argument(
                "resource_id", nargs="?" if id_kind == "device" else None,
                help=f"{id_kind} id" + (" (defaults to COSMO_DEVICE_ID or sole watch)" if id_kind == "device" else ""),
            )
        if name in IMAGE_COMMANDS:
            s.add_argument("--output", required=True, help="new file to save binary image into")
        s.set_defaults(func=cmd_read)

    s = sub.add_parser("send-message", help="send a text chat message to a watch")
    s.add_argument("device_id", nargs="?", help="watch id (defaults to COSMO_DEVICE_ID or sole watch)")
    s.add_argument("message", help="text to send")
    s.add_argument("--yes", action="store_true", help="confirm sending the real message")
    s.set_defaults(func=cmd_send_message)

    s = sub.add_parser("create-safe-zone", help="create an enabled safe zone for selected watches")
    s.add_argument("name", help="safe-zone name")
    s.add_argument("latitude", type=float, help="safe-zone center latitude")
    s.add_argument("longitude", type=float, help="safe-zone center longitude")
    s.add_argument(
        "--radius", type=float, default=SAFE_ZONE_MIN_RADIUS,
        help="radius in meters (200-600; default: 200, about 656 ft)",
    )
    s.add_argument("--device", action="append", required=True, help="watch id; repeat for each watch")
    s.add_argument("--yes", action="store_true", help="confirm changing real watch settings")
    s.set_defaults(func=cmd_create_safe_zone)

    s = sub.add_parser("create-focus-mode", help="create a Focus Mode schedule (lockdown off by default)")
    s.add_argument("name", help="Focus Mode name")
    s.add_argument("start_time", help="start time in 24-hour HH:MM format")
    s.add_argument("end_time", help="end time in 24-hour HH:MM format")
    s.add_argument("--device", action="append", required=True, help="watch id; repeat for each watch")
    s.add_argument(
        "--days", default="mon,tue,wed,thu,fri",
        help="comma-separated days; default: mon,tue,wed,thu,fri",
    )
    s.add_argument("--lockdown", action="store_true", help="enable lockdown for this schedule (default: off)")
    s.add_argument("--yes", action="store_true", help="confirm changing real watch settings")
    s.set_defaults(func=cmd_create_focus_mode)

    for name, (_, resource_kind, list_command) in DELETE_ENDPOINTS.items():
        s = sub.add_parser(name, help=f"delete a {resource_kind} by id (requires --yes)")
        s.add_argument("resource_id", help=f"{resource_kind} id from `{list_command}`; not a watch id")
        s.add_argument("--yes", action="store_true", help="confirm deleting the resource from real watch settings")
        s.set_defaults(func=cmd_delete)

    s = sub.add_parser("update-focus-mode", help="enable/disable a schedule or remove assigned watches")
    s.add_argument("resource_id", help="schedule id from `alarms`; not a watch id")
    enabled = s.add_mutually_exclusive_group()
    enabled.add_argument("--enable", dest="enabled", action="store_const", const=True, default=None, help="enable the saved schedule")
    enabled.add_argument("--disable", dest="enabled", action="store_const", const=False, help="disable the saved schedule without deleting it")
    s.add_argument("--remove-device", action="append", default=[], help="assigned watch id to remove; repeat as needed")
    s.add_argument("--dry-run", action="store_true", help="read current settings and show the request without writing")
    s.add_argument("--yes", action="store_true", help="confirm changing real watch settings")
    s.set_defaults(func=cmd_update_focus_mode)

    s = sub.add_parser("unregister-device", help="remove a watch from the account (eSIM deletion off by default)")
    s.add_argument("device_id", help="explicit watch id from `devices`")
    s.add_argument("--delete-esim", action="store_true", help="also request eSIM deletion (default: off)")
    s.add_argument("--dry-run", action="store_true", help="check the account and show the request without writing")
    s.add_argument("--yes", action="store_true", help="confirm removing the real watch from the account")
    s.set_defaults(func=cmd_unregister_device)

    s = sub.add_parser("device", help="full JSON + address for each watch (or one, by id)")
    s.add_argument("device_id", nargs="?")
    s.add_argument("--no-geocode", action="store_true")
    s.add_argument("--yes", action="store_true", help="confirm active tracking when using --turbo")
    s.add_argument(
        "--turbo", "--realtime", dest="turbo", action="store_true",
        help="enable active tracking (wakes the watch) and wait for a fresh fix first",
    )
    s.set_defaults(func=cmd_device)

    s = sub.add_parser("locate", help="enable turbo mode and wait for a fresh fix")
    s.add_argument("device_id", nargs="?")
    s.add_argument("--duration", type=int, default=ACTIVE_TRACKING_DURATION)
    s.add_argument("--frequency", type=int, default=ACTIVE_TRACKING_FREQUENCY)
    s.add_argument("--no-wait", action="store_true", help="don't poll for the new fix")
    s.add_argument("--yes", action="store_true", help="confirm changing real watch settings")
    s.set_defaults(func=cmd_locate)

    s = sub.add_parser("stop", help="disable turbo mode")
    s.add_argument("device_id", nargs="?")
    s.add_argument("--frequency", type=int, default=ACTIVE_TRACKING_FREQUENCY)
    s.set_defaults(func=cmd_stop)
    s.add_argument("--yes", action="store_true", help="confirm changing real watch settings")

    return p


def main() -> None:
    load_dotenv(ENV_FILE)
    args = build_parser().parse_args()
    email, password = os.environ.get("COSMO_EMAIL"), os.environ.get("COSMO_PASSWORD")
    if not email or not password:
        sys.exit("Set COSMO_EMAIL and COSMO_PASSWORD (env vars or .env file).")
    client = CosmoClient(email.strip().lower(), password, verbose=args.verbose)
    try:
        args.func(client, args)
    except CosmoAuthError as err:
        sys.exit(f"Auth error: {err}")
    except CosmoApiError as err:
        sys.exit(f"API error: {err}")
    except (ValueError, OSError) as err:
        sys.exit(f"Error: {err}")


if __name__ == "__main__":
    main()
