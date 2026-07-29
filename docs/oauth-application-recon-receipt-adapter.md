# OAuth application reconnaissance receipt adapter

The OAuth application reconnaissance adapter is a pure, network-free boundary
between the existing four-read diagnostic result and the canonical scenario
evidence receipt verifier. It accepts only reduced categorical input and never
acquires a token, performs a Graph or audit read, retries an operation, or
persists evidence.

The workload journal is exact and ordered:

1. bounded directory-membership collection reachability;
2. bounded mailbox-folder collection reachability;
3. personal-drive root reachability; and
4. shared-drive root reachability.

Both collections must be complete within the upstream bound. The adapter
retains no counts. Completing all four steps proves only the aggregate
`run-bounded-recon-reads` operation. It does not prove tenant contents,
identity details, detector attribution, learner interpretation, external
impact, or audit completeness.

Detector promotion requires a separately supplied current, untruncated exact
service-principal sign-in match owned by the canonical detector. That event
proves the workload token event only, not each read. The workload role cannot
supply detector evidence. Learner visibility likewise requires a separate
learner-owned observation; the canonical manifest says interpretation is
available rather than completed, so the interpretation operation,
interpretation claim, and response remain uninspected.

The manifest retains both Graph permission baselines and has no cleanup-owner
terminal read. A fresh-token, complete observation may establish that
temporary grants are absent and the retained baseline was restored. It does
not prove that the separate in-memory evidence-window close operation ran.
That operation plus cleanup, retention, and permission-revocation claims remain
uninspected because PR #78 cannot ground them from the permission observation.
Calling the retained baseline revoked fails closed.

Input rejects unknown fields, incomplete or reordered journals, pagination
uncertainty, stale or ambiguous detector events, actor conflation, semantic
overclaim, raw IDs, UPNs, URLs, names, counts, times, correlations, secrets,
paths, payloads, and arbitrary evidence text. Output is a frozen candidate
receipt that passes the authoritative canonical verifier.
