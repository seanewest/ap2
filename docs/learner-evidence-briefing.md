# Learner evidence briefing

The learner evidence briefing is a bounded, read-only projection of one
accepted canonical plan and one verified sanitized receipt. It currently
supports only the proven `help-desk-email-observation` contract.

An authenticated operator must first preview the exact help-desk plan with a
distinct producer and learner, explicitly select the learner's declared report
action, and verify the canonical receipt. Opening the briefing is then a local
in-memory view change. It makes no additional API request and cannot stage,
regenerate, retry, reply to, forward, delete, or clean up evidence.

The learner view contains only:

- the allowlisted scenario title and context;
- Outlook email as the evidence type, its observed status, and briefing time;
- the manifest-defined evidence-producer and learner labels;
- the learner observation task and expected interpretation;
- the one manifest-declared report action; and
- the manifest's canonical support reference.

The view does not contain producer controls, receipt claim IDs, operation
keys, markers, cleanup instructions, request bodies, credentials, or raw
tenant/user/object identifiers. It is a briefing about an existing artifact,
not proof that the learner created it and not authority to perform work.

## Fail-closed binding

The projection revalidates the plan through the browser-safe typed-client
contract and the receipt through the authoritative pure verifier. It refuses a
missing or stale plan, wrong scenario or learner alias, actor conflation,
expired window, unsupported response, mismatched receipt roles, unproven
artifact/learner-visibility/terminal claims, unknown fields, or unsafe
identifiers.

Any plan input edit, new plan submission, account initialization, account
change, or sign-out clears the retained in-memory plan. The briefing itself is
not written to browser storage. The canonical support reference identifies the
public capability record; it is not a request-correlation reference, evidence
payload, retry token, or authorization.

The route deliberately does not prove a learner authentication session. A
separate signed headless product-path test proves that the operator can prepare
the bounded projection while the rendered learner surface contains no
operator/admin controls.
