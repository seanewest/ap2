# Durable AP2 runtime boundary

AP2 browser, CBA, and Dev/Graph automation requires an owner-only protected
runtime on the durable `work` CT. The AgentTools runtime redesign removed the
legacy replacement-state tree that previously held this material. As of the
2026-08-20 post-migration reconciliation, that protected AP2 runtime has **not**
been found at a new live path on `work`.

Do not treat the former
`/var/lib/codex-agent-tools-replacement/worker/ap2-runtime` path as current and
do not invent a replacement location in an assignment. Browser/CBA-heavy AP2
work that needs this material must first restore/rehome the protected runtime
from the retained migration recovery sources and then set `AP2_RUNTIME_ROOT` to
that verified owner-only location.

The intended layout remains:

```text
$AP2_RUNTIME_ROOT/
├── secrets/       # standing protected AP2 material
├── runs/          # disposable outputs; never reusable browser state
└── containers/    # reproducible browser image storage
```

On the current `work` CT the runtime, once restored, should be owned by `agent`
and remain private: root/private directories mode `0700`, protected files mode
`0600`. Secrets, cookies, browser storage state, cached interactive sessions,
and machine profiles do not belong in Git or report output.

## Standing protected material

The protected runtime is expected to restore the standing material previously used by AP2:

- the Lisa simulated-user CBA issuer material;
- Cory, Homer, Kobe, Marge, and Rachel user certificates, encrypted keys, PFX
  files, passphrase references, and sanitized records;
- the dedicated SPA operator certificate material;
- the Dev/Graph automation certificate and protected configuration;
- public certificates and sanitized metadata beside their protected sources.

Create a fresh nonpersistent browser context from the applicable standing
certificate for each run. Do not preserve cookies or export reusable signed-in
browser state.

Once restored, normal work should use only this durable runtime. Historical WSL
copies, Proxmox snapshots, or dated backups are recovery sources, not ordinary
execution dependencies. Routine AP2 work must not recreate the retired bridge or
depend on a human workstation.

## Current identity boundary

`AP2 Simulated User CBA` is the standing eligibility group for the enabled X.509
authentication-method policy. The retained simulated users use their exact
Microsoft mappings and certificates from the protected runtime. Actor-specific
work must still select the user whose attribution and evidence matter.

The broad Dev/Graph identity remains a development and diagnostic tool. It is
not a substitute for delegated user execution when Microsoft or Windows must
record a specific simulated user.

## Readiness

After a verified `AP2_RUNTIME_ROOT` has been restored, install repository
dependencies with `npm ci`, export that path, then run:

```sh
export AP2_RUNTIME_ROOT=/verified/owner-only/ap2-runtime
npm run check:durable-runtime
```

The full readiness command checks owner and mode boundaries, protected inventory
hashes, certificate/private-key matches, all simulated-user PFX passphrases,
certificate validity, the Dev credential key match, a fresh Chromium context,
and the deterministic fake microphone against a loopback-only page. It performs
no Microsoft sign-in, paste, call, Graph request, tenant mutation, identity
change, or permission change.

For a narrower local browser-layer check:

```sh
npm run check:durable-runtime -- --browser-only
```

That proves only the pinned browser and fake-microphone layer. A successful
readiness check proves local protected material and browser preparation, not a
live Microsoft capability.

The initial migration, one-time WSL transfer, certificate renewal, Rachel
addition, and exact validation evidence are retained separately in
[the runtime migration history](durable-runtime-migration-history.md).
