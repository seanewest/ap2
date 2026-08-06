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
  SPA through the hosted API. The remaining current capability gap is the fixed
  Kobe-to-Cory help-desk Outlook email through the SPA/API path.
- Gamma owns durable assignment `51a7f211-ac7d-43f8-8443-3ab00a229c26` to close
  that gap. The working diagnosis is that the deployed Container App lacks
  Kobe's existing CBA configuration. Gamma is active; the coordinator is idle.

## Next dependency

Wait for Gamma's bounded result. Success means the deployed API reuses the
existing Kobe CBA configuration, one authorized SPA click is accepted, and the
fixed email is observed in Cory's mailbox. If the diagnosis is materially
wrong, the goal explicitly stops for Sean rather than opening a broader repair
tree.

Sean is also watching whether the coordinator applies the recently clarified
judgment rules well in practice; preserve that emphasis without creating extra
process around it.
