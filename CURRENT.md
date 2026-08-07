# Current work

This is the current docket, not a history ledger or future backlog. Completed
capability evidence belongs in `docs/proven-capabilities.md`; durable product
rules belong in `AGENTS.md` and focused architecture documents.

## Current objective

Finish proving the internal SPA as a real control surface for the tenant
capabilities AP2 has already built, without expanding small deployment gaps into
new architecture work.

## Current state

- The Microsoft 365 Business Premium and Defender licenses were extended for
  another 30 days, so replacement-tenant migration is not current work. PR #172
  remains useful as a reconstruction specification.
- PR #178 reorganized the SPA as the approved internal capability notebook.
  PRs #181 and #184 are merged: redundant capability-card subtext is removed
  and the obsolete generalized scenario/lab framework is retired.
- PR #186 is merged and adds the local Vite proxy used by `ap2-local`, so local
  SPA testing can reach the hosted Azure API without changing production CORS.
- The coordinator dispatcher repair is complete and live on the simplified
  schema-2 design. The current coordinator strategy explicitly preserves parent
  purpose through delegation, treats review findings by materiality, and uses a
  complexity brake after repeated correction loops or failed live attempts.
- The other tenant-backed SPA actions were exercised successfully from the local
  SPA through the hosted API.
- The Kobe-to-Cory help-desk button gap is complete and independently reviewed
  in draft PR #189 and deployed revision `ca-ap2-api--0000016`. The two supplied
  `500` responses were caused by a replica-lifetime one-shot latch after an
  earlier `202`, not missing Kobe CBA; mailbox reconciliation proved neither
  failure sent mail. One authorized hosted SPA click against the correction
  made exactly one API `POST`, received `202`, and added exactly one matching
  message in Cory's Inbox.

## Next dependency

Gamma's active unattended-AVD-session assignment
`d643f5ed-6eca-4b6f-a03b-17de5525660f` is the next dependency. No further
help-desk email send is needed for this proof.

Sean is also watching whether the coordinator applies the recently clarified
judgment rules well in practice; preserve that emphasis without creating extra
process around it.
