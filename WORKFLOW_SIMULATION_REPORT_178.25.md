# Workflow Simulation — 178.25.260830

## Migration parity URL scenarios
- bare Supabase project base URL -> canonical `/rest/v1/schema_migrations` endpoint
- base URL with trailing slash -> same canonical endpoint
- copied `/rest/v1` endpoint -> duplicate REST suffix removed
- copied `/rest/v1/...` endpoint -> reduced to project origin
- query/hash fragments -> removed
- malformed URL -> fail closed with explicit configuration error
- unrelated path -> fail closed instead of issuing an ambiguous PostgREST request
- missing URL/service-role key -> existing fail-closed behavior preserved
- fixture mode -> existing offline ledger-test behavior preserved

No application state, scoring, persistence, retry, rollback, or adjacent gameplay workflow is changed by this CI-only patch.
