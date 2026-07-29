# Help-desk email receipt adapter

The pure local help-desk adapter converts one reduced categorical result from
the existing one-shot email operation plus separately supplied learner and
cleanup observations into a candidate canonical evidence receipt. It performs
no send, Graph call, retry, read, persistence, or other external work.

The adapter accepts only the canonical help-desk scenario and operation. Its
operation result must say that the one-shot request was accepted, and its
two-entry journal must record the matching attempt followed by acceptance.
That pair proves only the `send-help-desk-email` operation result. It does not
prove delivery, an authentic artifact, learner visibility or interpretation,
response, cleanup, retention, detection, a Teams call, or voicemail.

A learner-visible authentic Outlook artifact requires a separate
learner-owned inspection of the canonical `read-marker-after` operation. That
observation can also preserve the message as honestly retained while cleanup
remains `uninspected`. A cleaned result additionally requires the canonical
delete operation and a separate learner-owned exact terminal absence
observation; cleanup and retention absence are never inferred from deletion
acceptance.

The canonical manifest currently marks learner interpretation as available,
not completed. The adapter therefore rejects an attempted interpretation
promotion even when a distinct learner response observation is supplied.
Changing that truth requires a deliberate manifest update, not adapter
inference.

Input is bounded categorical JSON with exact fields. Raw sender or recipient
addresses, tenant/user/message/object identifiers, subject, body, run marker,
tokens, paths, timestamps, upstream request/response payloads, and arbitrary
errors are rejected. Ambiguous, refused, failed, incomplete, duplicated,
reordered, cross-scenario, role-conflated, cleanup-incomplete, or
Teams/voicemail-conflated inputs fail with a fixed categorical adapter code.
The authoritative receipt verifier validates every emitted candidate.
