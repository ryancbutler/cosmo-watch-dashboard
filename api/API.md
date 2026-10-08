# COSMO / FiLIP API reference

This unofficial reference is provided for informational and educational purposes. It is not affiliated with or endorsed by COSMO or FiLIP. Endpoint availability, request validation, and response behavior may vary by account, device, and service version. Examples are placeholders, and schemas are partial.

The [OpenAPI document](openapi.yaml) contains the endpoint inventory and available request/response schemas. A generic JSON object indicates that the complete shape is not specified. Documenting a route does not imply that the CLI exposes it or that it is available to every account.

## Transport and authentication

The CLI and dashboard use `https://api.myfilip.com/v2`. Paths in the tables include `/v2`; paths passed to the Python client may omit that prefix.

`POST /v2/token` accepts `email`, `password`, `whiteLabelId: 18`, and `appBuild`. The token response includes `accessToken`, `refreshToken`, and `expDate`. `POST /v2/token/refresh` accepts a refresh token. Authenticated requests use `Authorization: Bearer <accessToken>`, `X-Accept-Version: 1.0`, and `X-Accept-Offset` for the local UTC offset in hours.

The Python client refreshes tokens before expiry. HTTP 401 or a JSON envelope with `status: 2` triggers one authentication retry. HTTP/API 403 means denied access and does not trigger another login. Successful JSON responses commonly wrap results in `data`; image routes can return bytes, JSON, or an empty response.

## Endpoint inventory

Authentication POSTs and stored-history queries are distinct from device mutations. Tracking, messaging, settings, pairing, firmware actions, and configuration writes can affect real devices or account state. The CLI requires `--yes` for its device mutations. Only operate on an account you are authorized to access.

### Account

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v2/token` | Sign in |
| POST | `/v2/token/refresh` | Refresh session |
| POST | `/v2/logout` | Sign out |
| POST | `/v2/user/register` | Register user |
| POST | `/v2/user/register/gabb` | Register Gabb user |
| POST | `/v2/sso/gabb` | Gabb SSO login |
| POST | `/v2/user/emailVerification` | Begin email verification |
| POST | `/v2/user/isVerified` | Check email verification |
| GET | `/v2/countries` | List countries |
| POST | `/v2/password/change` | Change password |
| POST | `/v2/password/set` | Set password |
| GET | `/v2/user/profile` | Get current profile |
| PUT | `/v2/user/update` | Update current profile |
| GET | `/v2/user/image` | Get current user image |
| POST | `/v2/user/unregister` | Unregister current user |
| POST | `/v2/push/register/fcm` | Register FCM |
| POST | `/v2/analytics` | Send analytics |
| POST | `/v2/feedback` | Send feedback |

### Device

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v2/map` | List devices and locations |
| POST | `/v2/map/refresh` | Refresh all device locations |
| POST | `/v2/map/refresh/{deviceId}` | Refresh device location |
| POST | `/v2/map/history/{deviceId}` | Get location history |
| GET | `/v2/safezones` | List configured safe zones |
| POST | `/v2/safezones` | Create safe zone |
| PUT | `/v2/safezones/{id}` | Update safe zone |
| DELETE | `/v2/safezones/{id}` | Delete safe zone |
| POST | `/v2/location` | Report device location |
| POST | `/v2/findMyWatch/{deviceId}` | Find my watch |
| POST | `/v2/event/{deviceId}` | Send device event |
| POST | `/v2/callnotifications` | Request call from device |
| GET | `/v2/device/profile/{deviceId}` | Get device profile |
| PUT | `/v2/device/update-profile/{deviceId}` | Update device profile |
| GET | `/v2/device/image/{deviceId}` | Get device image |
| POST | `/v2/device/register/imei` | Register device by IMEI |
| POST | `/v2/device/register` | Register device by MDN |
| POST | `/v2/init-pairing/{imei}` | Initialize tracker pairing |
| POST | `/v2/sendActivationCode` | Send activation code |
| POST | `/v2/sendActivationCode/{imei}` | Send activation code to IMEI |
| POST | `/v2/device/unregister` | Unregister device |
| POST | `/v2/firmware/check/{deviceId}` | Check device firmware |
| POST | `/v2/firmware/update/{deviceId}` | Start firmware update |
| GET | `/v2/calllogging/{deviceId}` | Get call logs |
| GET | `/v2/eventlogs` | Read stored notifications |

### Contacts

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v2/contact` | List contacts |
| POST | `/v2/contact` | Add contact |
| PUT | `/v2/contact/{id}` | Update contact |
| DELETE | `/v2/contact/{id}` | Delete contact |
| GET | `/v2/contact/image/{id}` | Get contact avatar |
| POST | `/v2/contact/add-devices` | Add devices to contact |
| GET | `/v2/contact/emergency` | Get emergency contact |
| PUT | `/v2/contact/emergency/{id}` | Update emergency contact |
| GET | `/v2/friends` | Get pending friends |
| POST | `/v2/friends/{id}/approve` | Approve friend |
| POST | `/v2/friends/{id}/reject` | Reject friend |

### Health

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v2/alarms` | List alarms |
| POST | `/v2/alarms` | Create alarm |
| GET | `/v2/alarms/all` | List all alarms |
| PUT | `/v2/alarms/{id}` | Update alarm |
| DELETE | `/v2/alarms/{id}` | Delete alarm |
| GET | `/v2/stepcounter` | Get step leaderboard |
| POST | `/v2/stepcounter/list/daily/simple/{deviceId}` | Query stored daily step totals without syncing the watch |
| POST | `/v2/stepcounter/report/{deviceId}` | Request step sync |
| GET | `/v2/device/goals/{deviceId}` | Get step goal |
| POST | `/v2/device/goals/{deviceId}` | Update step goal |
| GET | `/v2/heartrate` | Get heart rate summary |
| POST | `/v2/heartrate/{deviceId}` | Get heart rate range |
| GET | `/v2/sleepmonitor` | Get sleep summary |
| POST | `/v2/sleepmonitor/{deviceId}` | Get sleep range |
| POST | `/v2/spo2/{deviceId}` | Get oxygen range |

### Messaging

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v2/todo` | List todos |
| POST | `/v2/todo` | Create todo |
| PUT | `/v2/todo/{todoId}` | Update todo |
| GET | `/v2/tokk` | Get chats |
| GET | `/v2/tokk/device/{id}/messages` | Get device messages |
| GET | `/v2/tokk/user/{id}/messages` | Get user messages |
| GET | `/v2/tokk/group/{id}/messages` | Get group messages |
| POST | `/v2/tokk/device/{id}/message` | Send device message |
| POST | `/v2/tokk/user/{id}/message` | Send user message |
| POST | `/v2/tokk/group/{id}/message` | Send group message |
| POST | `/v2/tokk/group` | Create group chat |
| PUT | `/v2/tokk/group/{id}` | Update group chat |
| DELETE | `/v2/tokk/group/{id}` | Delete group chat |
| POST | `/v2/tokk/picture` | Upload image |
| POST | `/v2/tokk/video` | Upload video |
| POST | `/v2/tokk/voice` | Upload voice |

### Settings

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v2/user/preferences` | Get preferences |
| POST | `/v2/user/preferences` | Update preferences |
| GET | `/v2/whitelabel-settings` | Get white-label settings |
| PUT | `/v2/settings/{deviceId}` | Change active tracking settings and wake watch |

## Device state and location

`GET /v2/map` returns last-known device state under `data.Devices[]`. It does not request a fresh watch fix.

| Field | Interpretation and limits |
| --- | --- |
| `id` | Device identifier. Use the correct resource identifier for each route. |
| `hardwareName`, `hardwareVersion` | Hardware description. A `JT5` version prefix suggests JrTrack 5; that retail-model mapping is an inference. |
| `latitude`, `longitude`, `gpsDate` | Last reported coordinates and report timestamp. Report freshness comes from `gpsDate`, not fetch time. |
| `radius` | Approximate location uncertainty; meters are inferred. Treat a location as an area rather than an exact point. |
| `isValid` | Report validity flag; it does not guarantee precision or freshness. |
| `shutdown` | Last-reported power state: true means off, false means on, absent means unknown. It does not prove current connectivity. |
| `batteryLevel`, `externalBatteryLevel` | Separate reported fields. Their hardware-source relationship is unspecified; do not substitute one for the other. |
| `sourceType`, `deviceStatus`, `status`, `externalStatus` | Numeric state/source meanings are unspecified. Do not infer GPS, network, or online status from them. |

`PUT /v2/settings/{deviceId}` changes `activeTrackingEnable`, `activeTrackingDuration`, and `activeTrackingFrequency`. Duration and frequency are seconds. Tracking can wake the watch and increase battery use.

The location-history POST has an unspecified request body and is not called by these tools. Dashboard history consists of collected reports, not a complete service-history backfill.

## Safe zones and schedules

Safe-zone bodies include `name`, `address`, string `latitude`/`longitude`, `radius`, `enabled`, `type`, and `devices`. The CLI accepts radii of 200-600 meters, defaults to 200, and creates enabled zones with enabled device assignments, `silent: false`, `silentDays: [1,2,3,4,5,6,7]`, and `type: 0`. Address can return null after creation; use coordinates and assignments when checking persisted state.

Alarms and Focus Mode share `/v2/alarms`. Alarm reads use `title`, `enabled`, `time`, `endTime`, `weekDays`, `devices[].id`, `schoolMode`, and `focusMode`. Writes use differently cased fields such as `Name`, `Enabled`, `Time`, `EndTime`, `WeekDays`, and integer `Devices[]`.

Times are scheduled wall-clock seconds since midnight. Weekdays use a Monday-first seven-boolean array. Watch timezone semantics are unspecified. The CLI's Focus Mode body uses `SchoolMode: true`, `Type: 4`, and `Lockdown: false`; it rejects overnight ranges. An empty schedule list does not establish the current watch mode.

## Steps and notifications

`POST /v2/stepcounter/list/daily/simple/{deviceId}` queries stored daily steps with `startDate` and `endDate` as `YYYY-MM-DD`. Both clients require an increasing range of at most 31 days. Server boundary inclusivity is unspecified. This read-only POST does not invoke the separate watch-sync operation `/stepcounter/report/{deviceId}`.

The daily response contains `data.stepcount[]` with `day`, `totalStep`, and nullable `totalStepOnWatch`. For display, prefer non-null `totalStepOnWatch`, including zero, otherwise use `totalStep`; clamp negative display totals to zero. Preserve calendar days without timezone shifting. Leaderboard results may be empty independently of daily history. Step goals use `stepGoal`; an absent goal does not mean a zero goal.

`GET /v2/eventlogs` returns stored notifications with fields including `id`, `deviceId`, `created`, `translated`, `description`, `read`, and `deleted`. Reading does not mark notifications read. Dashboard normalization excludes deleted records and favors readable translated text. Notification counts and returned history sizes may differ.

## Conversations and downloads

Use the matching `/v2/tokk` roster: `data.devices` for device messages, `data.users` for user messages, and `data.groups` for group messages. Account/profile/contact IDs are not interchangeable with conversation IDs. The CLI checks roster membership before requesting messages. Empty responses do not establish that historical messages are available.

Text-message requests use `messageType: 1` and `data` containing the text. Image and media response types may vary. The CLI never overwrites existing download or backup files; chat backup destinations must be new directories outside the repository. Tokens are sent only to API-hosted attachments, not separate HTTPS hosts.

## Limits

This reference does not specify complete response shapes, pagination, rate limits, server authorization policy, all status values, or availability of legacy features. Optional health routes may return 404. Keep unspecified fields and enum meanings unspecified; do not treat the presence of an endpoint in Swagger as proof of support.
