# AI agent installation and setup

This guide starts without a local checkout. Install the Python CLI only;
Node.js, Docker, the dashboard, and Sites are not required. Complete local
installation and verification before any optional credentialed read.

## 1. Check tools and select a directory

Use a user-selected or workspace-appropriate parent directory. Check `git
--version` and your Python interpreter's version. Use Python 3.11 or newer with
`venv` and `pip`. On Windows, `py -3` may substitute for `python`; on Linux/macOS,
use `python3`.

If tools are missing, install Git and Python through the host's supported
package manager within the user's installation authorization, or use official
installers from [Git](https://git-scm.com/downloads) and
[Python](https://www.python.org/downloads/). Some Linux distributions package
venv/pip separately. Do not assume administrator access or change system
Python. If permissions block installation, report the missing tool and action
needed. Never install Python dependencies globally.

## 2. Obtain the source

From the chosen parent directory:

```sh
git clone https://github.com/ryancbutler/cosmo-api-explorer.git
cd cosmo-api-explorer
git status --short
```

If the destination already exists, inspect it before using it. Check `git
remote get-url origin` and the working tree. Preserve local changes; do not
reset, overwrite, or automatically pull into an unrelated or modified checkout.
If GitHub authentication is needed, use the existing Git credential manager or
approved GitHub authentication flow. Never embed tokens in clone URLs.

From the repository root, read `AGENTS.md`, `cli/README.md`, and `api/README.md`.
Keep application code in `cli/cosmo.py` and mocked tests in
`cli/tests/test_cosmo.py`. All remaining relative paths assume this root.

## 3. Install and verify locally

Cloning and dependency installation need network access. These checks require
no COSMO account credentials and make no live COSMO requests.

Windows PowerShell:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r cli/requirements.txt
.venv/Scripts/python.exe -m py_compile cli/cosmo.py
.venv/Scripts/python.exe -m unittest discover -s cli/tests -v
.venv/Scripts/python.exe cli/cosmo.py --help
```

Linux/macOS:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r cli/requirements.txt
.venv/bin/python -m py_compile cli/cosmo.py
.venv/bin/python -m unittest discover -s cli/tests -v
.venv/bin/python cli/cosmo.py --help
```

Check each exit status and resolve failures before continuing. Reuse a compatible
existing virtual environment rather than recreating it blindly. No activation,
editable-package install, or build step is needed: use the virtual environment's
interpreter directly.

Installation is complete when dependencies install, compilation and all mocked
tests pass, and help renders. Report the checkout path, interpreter path, and
actual results. Do not make credential provisioning or live testing a prerequisite
for successful installation.

## 4. Optional private credentials

The user enters credentials privately. Never request passwords in chat, print
an existing `.env`, or put real credentials into source. Follow the non-overwriting
copy commands and variable reference in [CLI README](README.md#credentials-and-env)
to copy `cli/.env.example` outside the checkout.

Default files are `%LOCALAPPDATA%/cosmo-api-explorer/.env` on Windows and
`~/.local/share/cosmo-api-explorer/.env` on Linux/macOS. Protect the directory
and file so only the user can access them. Live commands need `COSMO_EMAIL`
and `COSMO_PASSWORD` for the COSMO parent account; `COSMO_DEVICE_ID` is optional.
These are separate from dashboard and GitHub credentials.

Set `COSMO_DATA_DIR` and/or `COSMO_ENV_FILE` before launching Python for another
private location. Process environment values override file values. A repository
`.env` is not automatically loaded. Keep credentials and real IDs out of tracked
files, command arguments, transcripts, and installation prompts.

## 5. Optional authorized read

Only after the user authorizes access to their account:

```powershell
.venv/Scripts/python.exe cli/cosmo.py devices
```

On Linux/macOS substitute `.venv/bin/python`. This authenticates and reads
last-known watch reports without waking watches. Do not paste raw results or
IDs into chat; report sanitized success/failure. Tokens are cached outside the
repository. `python cli/tests/live_readonly.py` is a separate, explicitly
credentialed GET-only check apart from authentication; never run it automatically.
The `daily-steps` command separately permits a stored-history POST without
requesting watch sync.

## Agent operating rules

- Inspect the working tree and preserve existing edits. Keep documentation and Swagger aligned with route changes.
- Route every request through `CosmoClient.request()`. Keep named GET routes centralized in `READ_ENDPOINTS`. Validate IDs and date ranges before network calls.
- Obtain explicit user approval for live mutations even if `--yes` is present. All tracking, messaging, safe-zone, and Focus Mode writes require that flag.
- `update-focus-mode` changes enabled state or removes watch assignments; `unregister-device` removes a watch from the account. Preview with `--dry-run`, execute only with authorized `--yes`, and read current state after any error before considering a retry. eSIM deletion is off unless `--delete-esim` is explicitly supplied.
- Do not invent location-history bodies, status enums, timezone rules, or available chat history. Keep incomplete schemas and uncertain field meanings clearly labeled.
- Keep captures, image downloads, chat backups, tokens, and credentials outside the repository. Avoid logging personal response bodies. Use `device --no-geocode` to avoid external reverse geocoding.
- Run the mocked suite and syntax check after edits. Report actual results and any unverified live behavior. Never paste account data into documentation or fixtures.
