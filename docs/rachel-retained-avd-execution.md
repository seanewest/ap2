# Rachel retained AVD execution

`scripts/rachel-retained-avd-execution.mjs` is the bounded staging seam for a
benign browser action in Rachel's authentic retained Windows context. It owns
only a session that begins from zero sessions, and it never stops or deallocates
the retained VM.

Run the default AP2 page proof with a fresh marker:

```sh
AP2_RUN_ID=AP2-RACHEL-AVD-YYYYMMDDTHHMMSSZ npm run rachel-retained-avd -- run
```

`AP2_TARGET_URL` may select another HTTPS page under
`seanewest.github.io/ap2/`, but it must contain the exact run marker. `state` is
a read-only AVD/VM observation. `cleanup` requires the protected session receipt
for that exact run, logs off only its recorded session ID, and refuses any other
session.

The deterministic gates are observations, not elapsed-time assumptions:

- the exact retained VM assignment and a zero-session start boundary;
- VM `running`, AVD host `Available`, and still zero sessions after a start;
- one exact Rachel session in `Active` state plus a remote canvas of at least
  1200 by 700 pixels;
- one remote-keyboard Enter for the marked Edge command;
- a later GSA row naming Rachel, the retained device, `msedge.exe`, the exact
  query-free destination URL, `GET`, `200`, `allow`, and `success`;
- zero declared/listed sessions after one exact session-logoff submission, with
  unchanged VM power.

Azure VM start acceptance, AVD host registration, broker/session transitions,
Windows desktop rendering, and GSA log publication remain asynchronous. The
safe reconciliation observations are respectively instance power plus host
status, exact session state plus canvas dimensions, and the attributed GSA
transaction. AVD can replace its `Pending` session ID `-1` with the active
numeric session ID; the protected receipt reconciles only that exact transition.
A pending-placeholder cleanup recovery is valid for at most 15 minutes.
A VM-start operation receipt can remain `InProgress` after the VM
and host are ready, so the seam submits start once and reconciles state instead
of replaying it. Guest Run Command is intentionally not a readiness dependency:
the extension is serialized and can return `409` while unrelated authorized
endpoint work is using it.
