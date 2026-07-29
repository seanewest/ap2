# Failed-rehearsal operator support bundle

The authenticated operator shell can turn server support references from
failed rehearsal-verification requests into one small local diagnostic file.
This closes a narrow handoff gap: the failure message shows one reference, but
later panel activity can replace that message before an operator reports
several related failures.

The browser keeps at most the newest 12 eligible failures in memory. An
eligible failure must come from one of the six fixed rehearsal-verification
route owners and contain a server-generated support reference in the exact
`r1_` plus 24 lowercase hexadecimal format. Missing, malformed, or hostile
values are ignored.

The **Download support bundle** button is the only export action. It starts no
API request, retry, upload, or background work. If no eligible failure exists,
it creates no file. A successful explicit action downloads
`ap2-support-bundle.json`, capped at 4 KiB, with only:

- fixed schema, product-version, and browser-build labels;
- export and failure timestamps;
- fixed route-owner categories;
- fixed categorical failure statuses; and
- validated server support references.

The bundle never includes submitted rehearsal JSON, verifier output, success
data, response or request bodies, identities, tenant or object values, UPNs,
markers, evidence, credentials, tokens, cookies, browser state, paths, stack
traces, or arbitrary exception text. The application does not use
`localStorage`, `sessionStorage`, IndexedDB, cookies, or a server endpoint for
this feature. Reloading the page clears the in-memory collection.

A support reference identifies one API request. It does not establish whether
an external mutation succeeded or was absent, does not replace an operation
journal or marker, and never authorizes retry. Operators must review the
download before sharing it through an approved support path.

The bundle serializer is deterministic for a fixed sequence of failures and
timestamps. Unit tests exercise malformed references, hostile accessors,
invalid clocks, cardinality eviction, byte bounds, explicit-action behavior,
and payload exclusion. The signed local browser suite continues to prove that
authenticated panels make no request before their own explicit action.
