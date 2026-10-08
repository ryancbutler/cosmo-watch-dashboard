# Dashboard usage and operations

## Reading saved watch reports

The overview shows saved watch readings, reported power, battery, and last-known locations. A report's age comes from its location timestamp. Approximate map radii indicate uncertainty; positions and named safe-zone labels do not establish a precise location or confirmed arrival.

Select a watch to view its readings, or a safe zone to focus its boundary. Show all watches resets the map view. The map can be expanded in a dialog and restored with Escape. Unknown power, battery, and timestamps remain unknown rather than being replaced with guesses.

Alarms, safe zones, schedules, notifications, and recent activity have expandable sections. Alarms and schedules display wall-clock times and Monday-first repeat days. Schedule timezone semantics are unspecified; report timestamps use the viewer's timezone. Notifications remain read-only. Optional sections retain older data with a stale label after a failed refresh; a successful empty result clears the current section.

## Steps

Steps compares all watches in 7-day and 30-day views. Today's totals are separate from older reports. Missing days are gaps, and reported zero remains zero. Select a chart point to compare a day or expand the daily-totals table. Historical dates returned by the service are saved even if they predate the first collection. Goals can be absent independently of step totals.

## Saved history

Expand Saved history to select a report kind, watch, and date range. Supported kinds are locations, watch readings, steps, notifications, zones, and schedules. Location, watch-reading, and step history require a watch; zone and schedule history are account-wide. Removed watches remain available in the historical selector.

`GET /api/history` uses UTC bounds with `from` inclusive and `to` exclusive, a maximum 31-day span, and a `limit` of 1-200 (default 200). Follow the opaque `nextCursor` using the same filters for older records. Browser date selections use the viewer's local calendar, including daylight-saving transitions.

Location history separates watch report time from collection time. Repeated identical reports are deduplicated; stationary reports with new timestamps remain distinct. Untimestamped reports use collection time and are labeled accordingly. Map lines connect sampled timed reports no more than 15 minutes apart and do not represent a verified route. Battery/power history uses collection time. Daily-step corrections update saved totals without summing overlapping reports. Configuration history records changes, including transitions to empty configurations.

History grows through collection and has no automatic deletion. It is not a complete backfill of upstream location history. `/demo` supplies fictional readings and does not access the service or database.

## Collection and monitoring

The collector runs independently of browser visits. An external scheduler can invoke `POST /api/collect` every five minutes. The MCP server exposes collection and `collection_status` tools that return sanitized status and counts. Keep collection endpoints owner-private; broader access requires explicit account ownership and writer authorization. Browser dashboard/history requests read the database rather than contacting COSMO.

Collection has a two-minute upstream deadline, a three-minute database lease, overlap prevention, and five-minute success-bucket deduplication. History, catalog, snapshot, and run-completion writes are transactional and fenced by lease ownership. Failed collection keeps the previous snapshot; partial failures retain optional data with stale labels. Successful empty responses do not delete saved history.

Use `collection_status` to inspect attempts, successes, and failures. Monitor database capacity and table growth. Export normalized history by paginating authenticated requests for each kind, watch, and date range; save exports in private storage. Arrange a platform-supported D1 backup/export before destructive database maintenance. No purge or restore operation is exposed by the dashboard.

## Database migrations

Generate schema changes with `npm run db:generate` and include SQL, Drizzle metadata, and schema updates together. Hosted migrations are applied by the deployment platform. Local and hosted databases are separate.

After building, apply each local SQL migration once, in order, using `wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file <migration>`. Keep local databases outside published source.

## Scheduler

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Kubernetes template and secret configuration. The CronJob forbids overlap, uses execution deadlines, and mounts a read-only trigger script and service credential without granting Kubernetes API access. The trigger posts only to the configured HTTPS origin and refuses redirects.

Check jobs and sanitized logs in your chosen context and namespace. To pause collection, set the CronJob's `spec.suspend` to true; history remains stored. Failed jobs retry once. Run `python tests/trigger_test.py` before changing the trigger.
