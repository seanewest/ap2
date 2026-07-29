# Purview rehearsal verification API and client

The operator-only API exposes the authoritative offline Purview audit-boundary
rehearsal verifier at:

```text
POST /api/purview-audit-boundary-rehearsal-verification
```

The route is owned by
`purview-audit-boundary-rehearsal-verify` in the authoritative API route
contract registry. It is classified as pure, with no external call,
persistence, retry, or scheduling. Operator authorization completes before
the JSON body is read.

## Bounded transport

The endpoint accepts only the exact sanitized PR #129 `REHEARSAL_ONLY`
envelope, capped at 32 KiB, with unencoded `application/json`. The transport
parser rejects unknown or reordered fields, unsafe strings, raw identifier
shapes, cross-family envelopes, invalid digests, and out-of-bound counts before
the authoritative PR #131 verifier is invoked.

The response is capped at 4 KiB and must match the verifier's fixed
`REHEARSAL_ONLY_VERIFIED` summary exactly. The browser-safe typed client derives
the method, path, and bounds from the same route registry, validates the input
before fetch, caps streamed response bytes, preserves only fixed categorical
refusals, and rejects substituted or expanded response shapes.

## Proof boundary

The service imports the offline verifier directly. It does not import or invoke
the rehearsal pipeline or synthetic detector and performs no audit search,
result read, Graph or Purview call, scenario execution, background work,
telemetry, or persistence.

A successful API response proves only that the supplied sanitized output is
consistent with the local contracts. Audit submission or result access, live
SharePoint activity, external producer attribution, content, learner
visibility or interpretation, response, cleanup, retention, and impact remain
uninspected.

The signed local HTTP test proves authorization-before-body and route
isolation. The read-only Linux container fixture exercises the production API
image with a local signed token and the committed sanitized output:

```text
npm run test:purview-audit-boundary-rehearsal-container
```

This receipt-facing Purview boundary remains outside the runnable operator
scenario registry, so the endpoint does not add a UI or scenario-execution
surface.
