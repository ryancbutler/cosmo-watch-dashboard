# Copyable Sites installation prompt

Choose `realtime` or `history` in the first sentence before pasting. This prompt creates a separate installation and does not target the current deployment.

```text
Use the Sites plugin to install the COSMO family watch dashboard from the
dashboard/ directory of this repository as a NEW owner-private Site.
Use data mode: realtime. (Replace with history if saved reports are wanted.)
Keep DASHBOARD_AUTH_ENABLED=true unless I explicitly request disabling the
application login. If disabled, retain the new Site's owner-private access
policy: disabling app login does not disable the platform's access control.

Do not modify, publish over, change secrets on, or change scheduling for any
existing Site. Work in a separate sanitized installation checkout. Preserve
the repository's source; exclude secrets, private databases, runtime state,
captures, and any existing Site identity. Read dashboard/docs/DEPLOYMENT.md.

Register a new private Site and persist only its returned project identity.
Keep the starter's Sites build integration and ChatGPT authentication. Merge
dashboard/deploy/sites/hosting.<chosen-mode>.json into that new installation's
.openai/hosting.json while preserving the new identity and required platform
fields. Configure hosted COSMO_DATA_MODE to the chosen mode. Obtain COSMO_EMAIL
and COSMO_PASSWORD through secure hosted-secret setup; never put them in this
chat, source, browser code, ordinary files, prompts, or logs. Do not set
SELF_HOSTED, DASHBOARD_USERNAME, or DASHBOARD_PASSWORD for a managed Site.

In realtime mode, provision no D1 database and no collection schedule or MCP
collector capability. Verify direct read-only loading, current report times,
and that saved history, timeline, historical step charts, and History links
are absent. Verify /api/history is disabled and /api/collect cannot collect.

In history mode, provision a NEW D1 database bound as DB, apply all Drizzle
migrations through the Sites workflow, and enable the collector MCP capability.
Configure unattended collection every five minutes through supported private
Sites service access or collect_watch_reports. Keep service credentials out
of source and schedule prompts. Verify a successful initial collection and
that saved reports remain readable independently of subsequent COSMO reads.
Do not reuse another Site's database or service token. Preserve the existing
collapsed secondary panels and history UI.

Run npm test, npm run typecheck, python tests/trigger_test.py, and a verified
Sites build. Verify authentication and the selected mode in preview. Publish
only this NEW private installation using the supported Sites workflow and
report its URL, mode, and verification results. Describe any unavailable
scheduling or secure-secret setup explicitly instead of claiming completion.
All COSMO operations must remain read-only; never locate, stop, message, sync,
or modify real watch settings. A page refresh reads last-known reports and
does not request a new location from the watch.
```
