# Current work

This is the current docket, not a history ledger or future backlog. Completed
capability evidence belongs in `docs/proven-capabilities.md`; durable product
rules belong in `AGENTS.md` and focused architecture documents.

## Current objective

Explore how AP2 can create, preserve, and reopen genuine simulated-user Windows
endpoints, while beginning one realistic third-party SaaS identity-lifecycle
integration. Measure the available cost/performance shapes before making product
architecture decisions.

## Current state

- The internal SPA/control-surface cleanup is no longer the active frontier. The
  Kobe-to-Cory help-desk path is fixed and independently proven; do not reopen
  that work without new evidence.
- A genuine Windows 11 Enterprise 24H2 AVD personal-host path is proven through
  Entra join, Intune enrollment/compliance, Defender onboarding, assignment,
  unattended simulated-user sign-in, and a visible user desktop.
- Endpoint-local delegated Graph is also proven from a genuine Kobe Windows
  session: Windows native SSO through WAM used the signed-in Windows account to
  obtain a delegated Graph token and create the fixed OneDrive marker without
  CBA, app-only identity, browser UI, or a runtime LLM.
- Two clean fresh-workstation timing runs are now consistent: request/start to a
  visible usable simulated-user desktop took **14m 00.770s** and **15m 11.119s**.
  The VM itself was running in roughly a minute; most delay came from Entra,
  Intune, AVD, and first-session readiness.
- The same enrolled workstation, after verified deallocation, returned from an
  explicit open/start request to a visible usable Homer desktop in **2m
  58.578s**. This preserved its Entra, Intune, Defender, AVD, profile,
  assignment, and consent state.
- These measurements are evidence, not a product-cost decision. Deallocated VMs
  are useful during development. For a future learner flow, temporary warm state
  (for example, provision once, later hibernate/deallocate, then delete after a
  bounded period) remains one possible shape, but cost consciousness should not
  constrain exploration prematurely.
- Gamma owns active assignment `f1f71836-0c7d-4cec-bf9a-a2209cbece7e`: create a
  fresh enrolled Homer workstation, snapshot its enrolled OS state, reconstruct
  one replacement workstation from that snapshot, and time snapshot-to-usable
  desktop while observing Entra/Intune/Defender/AVD identity behavior. This is a
  one-for-one resurrection experiment, not an attempt to clone an enrolled
  endpoint into simultaneous copies.
- Retention rule for that experiment: if the restored workstation proves
  healthy, it becomes the canonical retained deallocated workstation and the
  older source VM/disk is retired; retain the snapshot as well. If restored
  identity is unhealthy or ambiguous, preserve the source instead. Do not run
  source and restored copies simultaneously.
- A second exploration line has begun around **YouTrack Cloud** as a non-Microsoft
  SaaS integration. The first bounded target is Entra SSO + SCIM 2.0 lifecycle:
  Entra assignment/group -> provision Cory/Kobe -> Entra SSO -> remove Kobe ->
  observe YouTrack deactivation/ban. Use a durable personal/admin YouTrack owner
  account outside the disposable Microsoft tenant. Defender for Cloud Apps
  Conditional Access App Control is a possible later experiment, not part of the
  first YouTrack proof.

## Next dependencies

1. Wait for Gamma's bounded snapshot-resurrection result: headline elapsed time,
   whether the resurrected endpoint is still coherently recognized by Entra,
   Intune, Defender, and AVD, and the storage/cost shape that remains afterward.
2. Continue the manual YouTrack setup far enough to establish the Entra auth
   module and SCIM connection, then prove one small joiner/leaver lifecycle before
   adding CASB/session-control complexity.
3. Keep observing coordinator judgment rather than making goals increasingly
   prescriptive. Routine reversible sandbox prerequisites should remain within a
   bounded goal unless repeated behavior shows the strategy needs correction.
