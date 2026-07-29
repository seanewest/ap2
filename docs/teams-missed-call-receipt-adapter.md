# Teams missed-call receipt adapter

The pure local Teams adapter converts a reduced categorical one-attempt staging
result plus separately supplied Cory-side observation, interpretation report,
and cleanup observations into a candidate canonical evidence receipt. It
performs no sign-in, call, Graph or bot action, read, retry, persistence, or
external work.

Stage completion proves only the `stage-one-audio-call` operation through the
licensed-user, audio-only, human-assisted path. It does not prove that Cory
received anything, that a native missed-call artifact exists, or that
voicemail, callback, learner visibility, interpretation, retention, or cleanup
occurred.

Artifact authenticity and learner visibility require one learner-owned
observation that categorically records both one `Missed incoming` history row
and one matching Activity notification as platform-native. That observation
can preserve retained history honestly while cleanup remains `uninspected`.
The adapter never treats the blocked Graph-bot result as this path.

A separate learner report may prove the canonical interpretation operation and
response only when its categorical conclusion is “missed Teams call without
voicemail.” The canonical manifest currently marks learner completion
`available`, not `completed`, so the authoritative verifier requires the
receipt's learner-interpretation row itself to remain `uninspected`. The
adapter does not rewrite that canonical/UI state.

Cleanup requires the canonical cleanup mutation plus a separate learner-owned
terminal read proving both history and Activity absent. It is never inferred
from elapsed time, hang-up, an originator quality prompt, one-surface absence,
or ambiguity after the action.

Input is bounded categorical JSON with exact fields. Raw user, tenant, call,
session, message, or Activity IDs; UPNs; timestamps; duration; screenshots;
markers; tokens; paths; client/browser state; payloads; and arbitrary text are
rejected. Ambiguous, refused, pre-identity, failed, incomplete, duplicated,
reordered, cross-scenario, bot-conflated, non-native, voicemail/callback,
role-conflated, or cleanup-incomplete inputs fail with fixed categorical
codes. The authoritative receipt verifier validates every emitted candidate.
