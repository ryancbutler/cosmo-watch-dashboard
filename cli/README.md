# COSMO Python CLI

Python CLI for exploring the FiLIP API (`api.myfilip.com/v2`) that
backs the COSMO JrTrack kids watch (COSMO is FiLIP white-label `18`).

This unofficial tool is provided for informational and educational purposes. Endpoint availability and behavior may vary by account and device. See the [API reference](../api/API.md) for request fields and limitations.

## Setup

```sh
python -m venv .venv && . .venv/Scripts/activate   # Windows Git Bash
pip install -r cli/requirements.txt
```

Run setup commands from the repository root. [AI_SETUP.md](AI_SETUP.md) covers
installation from scratch, including cloning the source. Activation is optional:
use `.venv/Scripts/python.exe` on Windows or `.venv/bin/python` on Linux/macOS
in place of `python` in the examples below.

## Credentials and `.env`

Use your COSMO parent-account email and password. These authenticate directly
to COSMO and are separate from dashboard, hosting, and GitHub login credentials.

| Variable | Required | Purpose |
|---|---|---|
| `COSMO_EMAIL` | Yes | COSMO parent-account email |
| `COSMO_PASSWORD` | Yes | COSMO parent-account password |
| `COSMO_DEVICE_ID` | No | Default watch ID for commands accepting an optional watch ID |
| `COSMO_DATA_DIR` | No | External directory for tokens, captures, and the default `.env` |
| `COSMO_ENV_FILE` | No | Path to a specific credentials file |

Default file locations:

- Windows: `%LOCALAPPDATA%/cosmo-api-explorer/.env`.
- Linux/macOS: `~/.local/share/cosmo-api-explorer/.env`.
- With `COSMO_DATA_DIR` set: `<COSMO_DATA_DIR>/.env`.

The CLI loads only this file or the file selected by `COSMO_ENV_FILE`. It does
not search for a repository or working-directory `.env`. Existing process
environment variables take precedence over file values. Set path overrides
before launching Python. `COSMO_ENV_FILE` changes the credentials location;
it does not move tokens or captures.

Copy the placeholder template outside the repository without overwriting
existing credentials. From the repository root in PowerShell:

```powershell
$cosmoPrivateDir = Join-Path $env:LOCALAPPDATA 'cosmo-api-explorer'
$cosmoEnvPath = Join-Path $cosmoPrivateDir '.env'
New-Item -ItemType Directory -Path $cosmoPrivateDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $cosmoEnvPath)) {
    Copy-Item -LiteralPath cli/.env.example -Destination $cosmoEnvPath
}
```

On Linux/macOS:

```sh
umask 077
mkdir -p "$HOME/.local/share/cosmo-api-explorer"
if [ ! -e "$HOME/.local/share/cosmo-api-explorer/.env" ]; then
    cp cli/.env.example "$HOME/.local/share/cosmo-api-explorer/.env"
    chmod 600 "$HOME/.local/share/cosmo-api-explorer/.env"
fi
```

Edit the external file privately; this is an example containing placeholders:

```dotenv
COSMO_EMAIL=you@example.com
COSMO_PASSWORD="replace-with-your-COSMO-password"
# Optional; use an ID returned by devices:
# COSMO_DEVICE_ID=12345
```

Restrict the directory and file to your user account. Never paste passwords
into chat, shell arguments, logs, or commits. A trusted secret manager may also
inject `COSMO_EMAIL` and `COSMO_PASSWORD` into the process environment.

Select another private file in PowerShell:

```powershell
$env:COSMO_ENV_FILE = 'C:\private\cosmo.env'
.venv/Scripts/python.exe cli/cosmo.py devices
```

Or on Linux/macOS:

```sh
COSMO_ENV_FILE=/private/cosmo.env .venv/bin/python cli/cosmo.py devices
```

`devices` contacts COSMO and displays account/watch data. Authentication caches
access and refresh tokens in `<COSMO_DATA_DIR>/.tokens.json` (using the default
data directory when no override is set). Treat tokens as secrets. `--help` and
mocked tests need no credentials or live requests. Agents should leave password
entry to the user and run credentialed reads only when authorized.

## Usage

| Command | What it does |
|---|---|
| `python cli/cosmo.py login` | Force a fresh `POST /token` (tokens are cached outside the checkout) |
| `python cli/cosmo.py devices` | One-line summary of each watch from `GET /map` |
| `python cli/cosmo.py map` | Full raw `GET /map` response — check for fields we don't use yet |
| `python cli/cosmo.py device [id]` | Full JSON + reverse-geocoded address for every watch, or just `id` / `COSMO_DEVICE_ID` if set. `--turbo` (or `--realtime`) requires `--yes`, wakes the watches and waits for fresh fixes first |
| `python cli/cosmo.py locate [id] --yes` | `PUT /settings/{id}` turbo mode, then polls `/map` ~2 min for a fresh fix |
| `python cli/cosmo.py stop [id] --yes` | Turn turbo mode back off |
| `python cli/cosmo.py send-message [id] TEXT --yes` | Send a text message to a watch through the device-message route |
| `python cli/cosmo.py create-safe-zone NAME LATITUDE LONGITUDE --device ID [--device ID] --yes` | Create an enabled safe zone; default/minimum radius is 200 m (about 656 ft; allowed range: 200–600 m) |
| `python cli/cosmo.py create-focus-mode NAME START END --device ID [--device ID] --days DAYS --yes` | Create a Focus Mode schedule; times use 24-hour `HH:MM`, days default to weekdays, and the default is non-lockdown |
| `python cli/cosmo.py backup-chats DIR` | Save every rostered conversation and available chat media into a new directory |

### Additional read commands

All commands below use GET. Watch ids are optional positional arguments,
falling back to `COSMO_DEVICE_ID` or the account's sole watch. With multiple
watches and no configured id, pass an id explicitly. User, group, and contact
ids must always be supplied explicitly.

| Commands | Data |
|---|---|
| `profile`, `preferences`, `countries`, `whitelabel-settings` | Account and configuration |
| `device-profile [id]`, `call-logs [id]` | Child profile and call history |
| `safe-zones` | Configured safe zones |
| `contacts`, `emergency-contact`, `friends` | Contacts and pending friends |
| `alarms`, `all-alarms`, `todos` | Schedules and todos |
| `steps`, `goals [id]`, `heartrate`, `sleep` | Health summaries and step goals |
| `notifications` | Stored notification history without marking records read |
| `chats`, `device-messages [id]`, `user-messages <id>`, `group-messages <id>` | Chat roster and conversations |
| `user-image --output FILE`, `device-image [id] --output FILE`, `contact-image <id> --output FILE` | Download an image to a new file |

Examples (create the external `../private-output` directory before an image download):

```sh
python cli/cosmo.py profile
python cli/cosmo.py --save contacts
python cli/cosmo.py device-profile 12345
python cli/cosmo.py call-logs 12345
python cli/cosmo.py device-messages 12345
python cli/cosmo.py user-image --output ../private-output/account.jpg
```

Image endpoints sometimes return JSON or an empty response instead of an image.
In those cases the command prints JSON and does not create the output file.
Existing output files are never overwritten. `--save` applies to JSON responses;
binary images use `--output`.

For message commands, run `python cli/cosmo.py chats` first. Use an id from
`data.devices` for `device-messages`, `data.users` for `user-messages`, or
`data.groups` for `group-messages`. Watch, contact, and account-profile ids
cannot be substituted for user-conversation ids. The CLI checks the matching
roster before requesting messages. HTTP 403 means access was denied and does
not trigger a login retry; HTTP 401 and expired-token envelopes still retry once.
Empty message lists do not establish that historical messages are available through this API.

### Chat backups

Create a new, private directory for each snapshot:

```sh
python cli/cosmo.py backup-chats PRIVATE_BACKUP_DIRECTORY
```

The command makes only GET requests. It saves the raw roster to `roster.json`,
one raw response per rostered conversation under `conversations/`, downloaded
audio/image attachments under `media/`, and `manifest.json` with retrieval time,
message IDs, content types, byte counts, and SHA-256 hashes. An attachment that
cannot be downloaded is recorded as an error in the manifest without discarding
the rest of the snapshot.

The destination must not exist; the command never overwrites a prior backup.
Treat the entire backup as sensitive family data and store it in an encrypted
location. `chat-backups/` is git-ignored. API-hosted media receives the normal
FiLIP bearer token; a separate HTTPS host is fetched without that token so an
attachment URL cannot disclose account credentials.

The Python client exposes these reads through `get_resource(name, resource_id)`.
The `READ_ENDPOINTS` registry lists names and paths.

Global flags (before the command): `-v` logs every request/response,
`--save` writes JSON to the external data directory's `captures/`.

Named commands define the supported routes. Device writes require `--yes`; no arbitrary-route or generic write command is exposed.
Verbose logging includes request URLs and response sizes, but excludes request
bodies so login passwords and refresh tokens are not logged.

## Known endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/token` | `email`, `password`, `whiteLabelId: 18`, `appBuild` → `accessToken`, `refreshToken`, `expDate` |
| POST | `/token/refresh` | `refreshToken` → new token set |
| GET | `/map` | All watches + last-known state under `data.Devices[]` (server cache, doesn't wake the watch) |
| PUT | `/settings/{deviceId}` | `activeTrackingEnable/Duration/Frequency` — turbo mode, wakes the watch |

Quirk: an expired token can come back as HTTP 200 with `{"status": 2}`.

## Development

From the repository root, run `python -m unittest discover -s cli/tests -v` and `python -m py_compile cli/cosmo.py`. The Swagger GET coverage test checks the named CLI routes. `python cli/tests/live_readonly.py` is an explicit credentialed GET-only smoke check, apart from authentication; it deliberately does not run daily-step POST queries. It prints metadata only and reports unavailable routes as failures.

Optional health endpoints may be unavailable, and message responses may be empty. See [API limitations](../api/API.md).

## Private configuration and outputs

Read [AI_SETUP.md](AI_SETUP.md). `COSMO_DATA_DIR` overrides the external state directory and `COSMO_ENV_FILE` selects an external credentials file. Defaults are `%LOCALAPPDATA%/cosmo-api-explorer` on Windows and `~/.local/share/cosmo-api-explorer` elsewhere. Process environment variables take precedence over the configured `.env` file. No repository `.env` is automatically loaded.

`--save` stores captures in the external state directory. Explicit image and chat-backup destinations must be outside the repository; the CLI refuses repository destinations. Do not include raw output in issue reports, tests, screenshots, or commits. `device --no-geocode` avoids sending coordinates to the external Nominatim reverse-geocoding service.

## Daily steps and notifications

`notifications` reads `GET /eventlogs` without marking notifications read. `daily-steps [id] --from YYYY-MM-DD --to YYYY-MM-DD` performs the stored-history `POST /stepcounter/list/daily/simple/{id}` with `startDate` and `endDate`. The range must increase and span at most 31 days. This does not invoke `/stepcounter/report/{id}` or wake the watch. Response calendar days stay calendar days; prefer non-null `totalStepOnWatch`, including zero, over `totalStep`. The command emits the raw envelope; it does not normalize totals.

## Watch mutations

`locate`, `stop`, `device --turbo`/`--realtime`, `send-message`, `create-safe-zone`, and `create-focus-mode` require `--yes`. There is no arbitrary-route or generic write command. Obtain explicit human authorization before running any mutation; validate the target and verify persisted state afterward. Tracking lasts 300 seconds by default. Focus Mode and safe-zone request fields are documented in [API.md](../api/API.md).
