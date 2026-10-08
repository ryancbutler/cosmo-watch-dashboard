# COSMO / FiLIP API reference

[API.md](API.md) explains endpoints, authentication, data fields, and limitations. [openapi.yaml](openapi.yaml) is an OpenAPI 3.0.3 document for Swagger UI and compatible tools.

This unofficial reference is provided for informational and educational purposes and is not affiliated with or endorsed by COSMO or FiLIP. Schemas are partial and endpoint availability may vary by account and device. Generic JSON objects indicate unspecified fields; they are not complete request-body instructions. `x-read-only: true` identifies the stored daily-step POST query.

The reference includes device state, authentication, contacts, messaging, schedules, safe zones, health data, and settings. The CLI implements a subset through named commands; the dashboard limits upstream calls to reads and authentication.

## Development

Keep named GET routes aligned with `cli/cosmo.py` and its Swagger coverage test. Do not invent undocumented fields, status enums, timezone rules, or location-history request bodies.

To validate the contract, install `openapi-spec-validator` in a development virtual environment and run `python -m openapi_spec_validator api/openapi.yaml` from the repository root. Runtime CLI dependencies are listed separately in `cli/requirements.txt`.
