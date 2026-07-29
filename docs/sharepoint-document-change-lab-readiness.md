# SharePoint document-change lab readiness

## Decision

AP2 cannot honestly publish the proposed SharePoint document-change
investigation as a learner lab yet.

The repository contains strong historical proof that a harmless SharePoint
file can be created, overwritten, inspected through version history, restored,
and removed. A separate detector later returned exact Purview records
attributing operations to the producer application. Those are valuable
capability conclusions, but they came from one-off diagnostic canaries. They
do not currently form one repeatable product path or one learner-visible
evidence chain.

Passing `parseLearnerLabDefinition` would only prove that the proposed card has
the right bounded shape. It would not prove that its evidence can be staged,
shown to a learner, acted on, reconciled, or cleaned up. The Lab catalog
therefore remains empty.

## Decisive contract audit

| Required link | Current truth | What must exist before publication |
| --- | --- | --- |
| Staging | **Missing runnable capability.** The hosted SharePoint action creates and removes one fixed file. The overwrite and version-history sequence exists only as a completed historical canary. | A source-backed, bounded create → trusted version → unexpected harmless change → exact version-read contract, with one-attempt and ambiguity behavior. |
| Distinct actors | **Partial.** Historical evidence distinguishes the producer application from the Purview detector. No runnable composite contract binds a human learner and an authorized responder separately from those systems. | Exact runtime bindings for the simulated producer, independent detector, human learner, and responder, with conflation rejected. |
| Learner-visible evidence | **Missing.** The Purview manifest deliberately records learner visibility as `not-proven` and learner completion as `not-run`. Version and audit details remain protected evidence; no learner briefing joins safe version facts to safe attribution facts. | A sanitized learner briefing backed by verified receipts for the changed version and exact producer attribution, with no raw IDs, paths, markers, or audit payloads. |
| Investigation prompt | **Design-ready, not runnable.** “Determine what changed, who or what changed it, and which version is trusted” is understandable, but it has no supported evidence briefing. | Bind that prompt to the verified learner-visible version and attribution claims. |
| Permitted learner action | **Missing completion path.** Recommending restoration is safe in principle, but no receipt records that learner decision. Historical restoration was an unconditional diagnostic recovery action, not a learner-authorized response. | A bounded report/recommendation action and, if restoration is offered, a separately authorized responder-owned exact-version restore operation. |
| Completion proof | **Missing.** No canonical receipt proves that the learner inspected both evidence sources, attributed the change within the allowed claim, chose an allowed response, and reached a terminal state. | A fail-closed completion receipt tied to the exact briefing, learner alias, response, and terminal readback. |
| Expiry and cost | **Missing composite envelope.** Individual historical work stayed inside its lane, but no candidate lab declares one current expiry, conservative duration, and USD ceiling across staging, delayed audit availability, response, and cleanup. | One bounded lifecycle and budget that accounts honestly for Purview latency without turning a submitted search into evidence. |
| Cleanup | **Missing composite ownership.** The historical file was deleted and audit-search history was accepted as service-managed residue. No runnable lab owns cleanup of the staged file, permissions, response state, evidence window, and retained audit history together. | Exact cleanup ownership and terminal checks for every mutable artifact, plus an explicit retained-history disposition. |

## Existing pieces that remain valid

- The fixed hosted SharePoint proof remains a create/remove capability. It is
  not an overwrite, version-history, restoration, or audit-attribution runner.
- The historical content-tampering and restoration conclusion remains valid
  for its fresh canary-owned file only.
- The Purview result proves exact operation-level producer attribution for its
  retained historical records. It does not prove content collection, learner
  visibility, or every SharePoint operation.
- The Purview manifest and rehearsal remain receipt-facing and
  `REHEARSAL_ONLY`; they are intentionally outside the runnable scenario
  registry.
- The existing help-desk learner briefing proves one scenario-specific
  briefing pattern. It is not a generic SharePoint learner surface.

## Next dependency

The smallest next step is not a Lab card. It is one source-backed runnable
staging path for the SharePoint change-and-version evidence pair. A
network-free contract and deterministic tests should define that path first,
but they are preparation rather than proof: the product must then execute the
bounded create → trusted version → harmless change → exact version-read
lifecycle and emit a verified receipt. A separately source-backed sanitized
Purview learner observation must produce a compatible receipt. Only after both
receipts exist should AP2 add the learner decision/completion contract and
evaluate a composite lab definition.

This sequence preserves the distinction between historical proof, repeatable
capability execution, learner-visible evidence, and a completed learning
experience.
