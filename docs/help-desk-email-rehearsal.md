# Help-desk email contract rehearsal

The help-desk email rehearsal is a deterministic, network-free compatibility
check for the canonical scenario plan, the existing one-shot send operation
type, the help-desk operation-to-receipt adapter, the authoritative receipt
verifier, and the shared rehearsal-envelope invariants. It uses only an
injected in-memory fake. It does not send email, call Microsoft Graph, inspect
a mailbox, persist a run, or prove external activity.

Run one sanitized fixture through the bounded CLI:

```sh
npm run rehearse:help-desk-email -- \
  scripts/fixtures/help-desk-email-rehearsal-send.json

npm run rehearse:help-desk-email -- \
  scripts/fixtures/help-desk-email-rehearsal-retained.json

npm run rehearse:help-desk-email -- \
  scripts/fixtures/help-desk-email-rehearsal-cleaned.json
```

The CLI accepts exactly one regular JSON file of at most 8 KiB. It writes one
deterministic safe JSON envelope to standard output. Requests contain only the
schema version, `REHEARSAL_ONLY` label, canonical scenario ID, and one fixed
synthetic branch. Missing, extra, unsafe, and cross-family fields fail closed.

## Pipeline

The pipeline:

1. compiles the canonical zero-cost help-desk scenario plan without selecting
   a learner response;
2. invokes one injected fake of the existing one-shot send operation exactly
   once and reduces it to categorical adapter input;
3. passes the reduced two-event send journal and bounded synthetic
   learner/cleanup observations directly to the help-desk receipt adapter;
4. verifies the candidate receipt through the authoritative receipt verifier;
   and
5. binds scenario/version/plan and fake-run digests and the exact synthetic
   terminal category through the shared rehearsal-envelope invariants.

The emitted envelope contains no receipt rows, operation payload, sender,
recipient, subject, body, marker, tenant/user/message/object identifier, UPN,
token, path, timestamp, or arbitrary provider text. Adapter and verifier
acceptance demonstrate contract compatibility only.

## Synthetic branches

`send-accepted` exercises the exact attempted-then-accepted journal. Artifact,
learner, retention, and cleanup observations remain synthetically
uninspected.

`learner-observed-retained` additionally exercises the distinct synthetic
learner observation needed by the adapter to represent an authentic visible
Outlook artifact and retained state.

`learner-observed-cleaned` adds the exact synthetic cleanup mutation and
separate learner-owned terminal absence observation. Post-cleanup absence
never substitutes for the earlier learner visibility observation.

All three outputs still label email send, Inbox visibility, learner
interpretation, response, cleanup, retention, audit/detection, Teams call, and
voicemail as externally `uninspected`. The canonical manifest does not mark
interpretation completed, so the pipeline never promotes interpretation even
in learner-observation branches.

## Refusal boundary

The fake lifecycle is invoked once and is never retried. Ambiguous, failed,
incomplete, reordered, duplicated, mismatched, unsafe, nonterminal,
cleanup-incomplete, retained-as-cleaned, role-conflated, Teams/voicemail
conflated, and evidence-overclaim inputs return fixed categorical failures
without echoing input. A valid fake result supplied under a different branch
is also refused.

The implementation has no real operation construction, network transport,
API route/client, UI, deployment, browser, or Windows-host path.
