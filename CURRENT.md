# Current work

At each material checkpoint, the Captain checks and updates this docket against repository state and protected evidence. Worker completion is a dependency checkpoint, not a stopping condition; advance the next safe action unless Sean, new authority, or an external wait is required.

## Waiting for Sean

- **Standalone Intune learner checkpoint:** The canary is deployed and reconciled in one isolated marked run, and automatic expiry deletion is active. Sean owns the single Bastion sign-in because human-visible learner evidence cannot be delegated; the expected outcome is reaching the Windows session, and the stop rule is the first authentication or access failure without configuration changes or repeated attempts. Intune enrollment and Defender onboarding are not yet proven.
- **Teams chat remediation:** Retained-chat learner visibility passed. Remediation waits for Sean to remove only Marge; agents then perform one admin membership read. The private cleanup identity and live evidence remain protected outside Git.
- **Teams call:** Reusable Call Canary code is merged to `main`, and call-disabled deployment/readiness passed. Live calling remains disabled; one bounded call waits for Sean's explicit GO. Protected deployment and learner evidence remain outside Git.

## Ready next

- **Agent tooling cutover:** Sanitized reusable source is published in the private `seanewest/codex-agent-tools` repository. Agents own the separate live-installation cutover; repository publication does not prove that the installed runtime changed.

## Parked

- **AVD personal prototype:** The protected design is ready for later implementation only after the standalone Intune canary and its cleanup finish. Re-prove provider, SKU/image/quota, RBAC, networking, and a conservative sub-$8 forecast; use one private Windows 11 Enterprise personal host with deployment-time Entra join and Intune enrollment.

## Cleanup later

- After learner inspection and the bounded endpoint/calling work, reconcile and remove only the protected exact Teams installation/catalog entry, calling resources, temporary workload roles, broad diagnostic permissions, delegated consent, retained drafts/messages where approved, and obsolete certificates/keys. Preserve accepted audit, quarantine, transport, deleted-object, and other historical residue.

## Closed/do not reopen

- PRs #44 and #45 are merged to `main`; their old branch/handoff actions are not current work.
- Retained Defender/EICAR mail correlation is complete and agent-proven: the message was blocked/quarantined, Cory's Inbox contained no matching message, and no related alert or incident was found. Never release, preview, download, or open the attachment; endpoint follow-on waits for the standalone Intune canary.
- `Standard_B2ms` is obsolete for the standalone canary; the reviewed design uses `Standard_D2s_v3`. The erroneous actor bundle is superseded and unusable, and the completed Teams package upload must not be repeated.
- The Defender custom-detection and temporary-application lifecycle lanes are closed. Keep their honest limitations and cleanup evidence; do not run another attempt.
