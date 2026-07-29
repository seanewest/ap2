# Private document evidence contract

The private-document runner stages one authentic, harmless plain-text artifact
for a distinct learner without asking the learner to generate it. It is a
cleanup-first backend contract, not a browser workflow and not an audit or
detection claim.

## Frozen plan

A scenario author supplies a unique marker, the fixed tenant, exact distinct
producer and learner, a verified producer-owned business drive, the existing
delegated Files scopes, and an ephemeral-retention policy. Planning fails
closed unless:

- the complete drive-root permission read contains only the producer owner;
- the marker path is absent and has not been used;
- the payload is the fixed harmless text category;
- the learner grant is one direct signed-in `read` permission with no sharing
  link or invitation email; and
- the producer owns permission, file, and empty-folder cleanup.

The sanitized plan omits tenant, user, drive, item, and permission identifiers.

## One-shot lifecycle

The runner records intent before each folder, file, permission, or cleanup
mutation. A mutation is attempted once. Ambiguous outcomes are reconciled by
exact reads and are never replayed. Absence after either an ambiguous or
definite mutation requires three exact reads separated by bounded waits.

Cleanup runs even after staging or learner-read failure. It removes the direct
permission, exact file, and then the verified-empty run folder. Producer
object absence and learner access absence are separate terminal observations.
Normal Microsoft audit and deleted-item history may remain.

Transport adapters are separate from the pure plan and state machine. Tests
use fakes and perform no shell or network access.

## Live boundary

A reviewed direct canary proved that the fixed producer could create and
reconcile the private folder, harmless text file, and exact learner-only read
permission using existing delegated authority. The bounded learner backend
read did not prove visibility, so learner interpretation, response, audit, and
detection are all unclaimed.

All three cleanup mutations succeeded. Fresh delegated identities then
completed three spaced terminal rounds: the producer saw the folder, item, and
permission surface absent, while the learner had no access to the exact item.
No active artifact, share, temporary grant, token cache, or credential was
retained.

## Scenario receipt adapter

`private-document-receipt-adapter.ts` is a pure local bridge from the reduced
lifecycle result, categorical journal, and terminal absence summary to a
candidate scenario evidence receipt. It performs no network call, retry,
mutation, execution, persistence, or protected-evidence read.

The input uses one sanitized run correlation only to reject mixed journals; the
correlation is never copied into the receipt. Exact folder, file, permission,
user, drive, tenant, path, marker, response, credential, and session values are
not accepted receipt fields.

The adapter accepts only the ordered one-shot lifecycle:

1. folder, file, and direct permission creation reach exact desired state;
2. the bounded learner read is recorded separately;
3. permission, file, and empty-folder deletion each reach exact absence after
   their propagation reads; and
4. three complete fresh-session terminal rounds prove producer object and
   learner access absence.

The cleaned canary receipt proves only platform-accepted private-document
staging and cleanup. Learner visibility stays `uninspected`. A successful
synthetic lifecycle can prove visibility only through the canonical
learner-owned exact evidence read with a `learner-inspection` observation.
Interpretation, response, audit, and detection are never inferred.
