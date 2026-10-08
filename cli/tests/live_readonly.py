"""Explicit live smoke test: GET resources plus login/refresh only.

Run from the repo root: python cli/tests/live_readonly.py
Outputs metadata only; never prints ids, personal data, or response bodies.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cosmo
from dotenv import load_dotenv


def main():
    load_dotenv(cosmo.ENV_FILE)
    client = cosmo.CosmoClient(os.environ["COSMO_EMAIL"].strip().lower(), os.environ["COSMO_PASSWORD"])
    transport = client.session.request

    def read_only_transport(method, url, **kwargs):
        if method != "GET" and not (
            method == "POST" and url in (cosmo.API_BASE + "/token", cosmo.API_BASE + "/token/refresh")
        ):
            raise AssertionError("Live smoke test blocked a non-read operation")
        return transport(method, url, **kwargs)

    client.session.request = read_only_transport
    failures = 0

    def check(label, read):
        nonlocal failures
        try:
            data = read()
            if isinstance(data, bytes):
                detail = f"binary, {len(data)} bytes"
            elif isinstance(data, dict):
                status = data.get("status")
                if status not in (None, 0, 200):
                    failures += 1
                    print(f"FAIL {label}: envelope status={status}")
                    return None
                detail = f"JSON, status={status}, data type={type(data.get('data')).__name__}"
            else:
                detail = type(data).__name__
            print(f"PASS {label}: {detail}")
            return data
        except cosmo.CosmoAuthError:
            raise  # Stop rather than repeatedly attempting login.
        except cosmo.CosmoApiError as err:
            failures += 1
            # Error bodies and URLs may contain account data; don't print them.
            message = str(err)
            code = message.split(" -> ", 1)[-1].split(":", 1)[0] if " -> " in message else type(err).__name__
            print(f"FAIL {label}: {code}")
            return None

    body = check("map", client.get_map)
    if body is None:
        return 1
    devices = body.get("data", {}).get("Devices", [])
    check("safe-zones", lambda: client.get_resource("safe-zones"))
    contacts = None
    chats = None
    for name, (_, kind, _) in cosmo.READ_ENDPOINTS.items():
        if kind is None:
            result = check(name, lambda name=name: client.get_resource(name))
            if name == "contacts":
                contacts = result
            if name == "chats":
                chats = result
        elif kind == "device":
            for index, device in enumerate(devices, 1):
                check(f"{name} (watch {index})", lambda name=name, did=device["id"]: client.get_resource(name, did))
            if not devices:
                print(f"SKIP {name}: no watches")
        elif kind == "contact":
            entries = (contacts or {}).get("data", {}).get("contacts", [])
            if entries:
                check(name, lambda: client.get_resource(name, entries[0]["id"]))
            else:
                print(f"SKIP {name}: no contacts")
        else:
            entries = (chats or {}).get("data", {}).get(kind + "s", [])
            for index, entry in enumerate(entries, 1):
                check(f"{name} (conversation {index})", lambda name=name, rid=entry["id"]: client.get_resource(name, rid))
            if not entries:
                print(f"SKIP {name}: no {kind} conversations")
    print(f"Live read failures: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
