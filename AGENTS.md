# Repository Guidelines

## Project Structure & Module Organization

This is a small Python CLI for inspecting the FiLIP API behind COSMO JrTrack
watches. Keep application code in `cli/cosmo.py`; it contains the argument parser,
`CosmoClient`, endpoint registry, transport, and output helpers. Keep the
API reference in `api/openapi.yaml` and human-facing endpoint notes in
`api/API.md` and `README.md`. Add mocked regression tests to
`cli/tests/test_cosmo.py`; reserve `cli/tests/live_readonly.py` for credentialed,
read-only smoke checks.

## Setup, Test, and Development Commands

```sh
python -m venv .venv && . .venv/Scripts/activate
pip install -r cli/requirements.txt
python -m py_compile cli/cosmo.py
python -m unittest discover -s cli/tests -v
python cli/cosmo.py devices
```

Use the final command only with valid `.env` credentials; it contacts the live
service. `python cli/tests/live_readonly.py` is a broader live check and must remain
GET-only (apart from authentication). The Python CLI has no build step, formatter, or linter. Dashboard commands and documentation live in `dashboard/`.

## Coding Style & Naming Conventions

Use four-space indentation, standard-library-first imports, and clear
`snake_case` functions and variables; classes use `PascalCase` (for example,
`CosmoClient`). Keep API route definitions centralized in `READ_ENDPOINTS` and
send all requests through `CosmoClient.request()` so authentication, retry, URL
validation, and redacted logging remain consistent. JSON belongs on stdout;
progress and diagnostics belong on stderr. Use `path.format(id="123")`-style
parameter handling and validate resource IDs before making requests.

## Testing Guidelines

Name tests `test_<behavior>` and mock HTTP at the client session/request layer.
Cover endpoint routing, authentication/retry behavior, validation, output file
safety, and write guards when changing a command. Keep tests independent of
credentials and personal data. Update the Swagger-GET coverage test whenever
you add a documented GET route.

## Safety, Configuration & Contributions

Use `cli/AI_SETUP.md` to provision an external private `.env`; never commit `.env`, `.tokens.json`, captures,
HAR files, device identifiers, locations, or phone numbers. `locate`, `stop`,
`device --turbo`, messaging, safe-zone, and Focus Mode commands change real watch settings. Preserve
the `--yes` write guard and do not issue live writes without explicit approval.

Use short imperative commit subjects consistent with history, such as `Add
device status command`. Pull requests should explain behavior and API evidence,
link an issue when applicable, list tests run, and call out any live-service
effects or unverified request schema.
