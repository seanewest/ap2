# Purview operation receipt adapter

`adaptPurviewOperationToReceipt` is a pure, network-free bridge from one
sanitized categorical Purview operation observation to the existing
`purview-sharepoint-audit-boundary` evidence receipt. It does not accept raw
audit records, identifiers, paths, markers, timestamps, payloads, or free-form
evidence.

The adapter accepts only the canonical scenario/version and actor aliases. A
detector result must already be `live-proven` and state the supported
SharePoint workload, file-operation record type and operation, exact workload
actor attribution, bounded event window, marker-bearing target, target type,
correlation, and bounded unpaged deduplication. A successful search, surface
reachability, sign-in, incomplete observation, duplicate page, or missing
field cannot prove detection.

One accepted observation proves only the capped result-page read, authentic
Purview summary, independent detector, surface reachability, exact producer
attribution, and terminal Purview surface claim. Query submission, learner
visibility and interpretation, response, cleanup, and retention remain
`uninspected`. The authoritative receipt verifier must still verify the
adapter output against the canonical manifest.
