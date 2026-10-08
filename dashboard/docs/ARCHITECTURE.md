# Architecture and data

`lib/filip.server.ts` owns upstream authentication and allowed reads. The collector reads `/map`, `/safezones`, `/alarms`, `/eventlogs`, per-watch `/device/goals/{id}`, and stored daily steps via `/stepcounter/list/daily/simple/{id}`. Only token authentication and that daily-history query allow upstream POST. Tracking, firmware, messaging, watch sync, and other writes stay blocked.

`lib/collector.server.ts` and `lib/archive.server.ts` persist normalized snapshots and history in D1. Browser dashboard/history requests read the database only. Collection uses a deadline, database lease, overlap prevention, and transactional writes. `/api/collect` and MCP collection tools return sanitized counts/status. Keep these operations owner-private; widening access requires explicit ownership/writer authorization.

Location age uses `gpsDate`; collected time is separate. Approximate radii use inferred meters. `shutdown` reports saved power state, not connectivity. Preserve unavailable, empty, stale, and zero as different states. Daily steps prefer non-null `totalStepOnWatch`, including zero, and retain source calendar dates. Numeric location/device enums and undocumented watch timezone behavior remain unknown.

History includes collected locations, battery/power readings, daily steps, notifications, and zone/schedule configuration changes. It is not a complete upstream location backfill. Demo data and mocked tests are fictional. Never commit a live database, live-data screenshots, personal Site identity, or upstream captures. See OPERATIONS.md for detailed UI, pagination, and retention behavior.
