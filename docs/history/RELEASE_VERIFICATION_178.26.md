# Release Verification — 178.26.260830

## Scope
PR-only staging integration harness correction. No application or database behavior change.

## Root cause
Supabase head/count queries return `data=null` while `count` lives on the full response. The Alternate Shot reset check discarded the full response through `expectNoError()` and then dereferenced `.count` on null.

## Correction
Retain the full response for the reset count query, assert `error` is absent, and read `count` directly. Assertion count remains unchanged. A source-contract guard locks the behavior.

## Validation
See executed release-gate output for 178.26. GitHub PR CI and the real staging integration gate remain authoritative for live Supabase execution.
