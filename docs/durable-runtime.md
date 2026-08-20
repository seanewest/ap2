# Durable AP2 runtime boundary

Ordinary AP2 browser, CBA, and Dev/Graph automation runs on the durable worker as
`codex_worker_replacement`. Its owner-only root is:

```text
/var/lib/codex-agent-tools-replacement/worker/ap2-runtime/
├── secrets/       # standing protected AP2 material
├── runs/          # disposable outputs; never reusable browser state
└── containers/    # pinned reproducible browser image storage
```

The absolute path reflects the current site deployment; it is not a generic
AgentTools product contract. AP2 scripts accept `AP2_RUNTIME_ROOT` when the same
owner-only layout is installed elsewhere.

The root and private directories are mode `0700`; protected files are mode
`0600`; all are owned by
`codex_worker_replacement:codex_worker_replacement`. Secrets, cookies, browser
storage state, cached interactive sessions, and machine profiles do not belong
in Git or report output.

## Standing protected material

The runtime currently contains:

- the Lisa simulated-user CBA issuer material;
- Cory, Homer, Kobe, Marge, and Rachel user certificates, encrypted keys, PFX
  files, passphrase references, and sanitized records;
- the dedicated SPA operator certificate material;
- the Dev/Graph automation certificate and protected configuration;
- public certificates and sanitized metadata beside their protected sources.

Create a fresh nonpersistent browser context from the applicable standing
certificate for each run. Do not preserve cookies or export reusable signed-in
browser state.

Normal work uses only this durable runtime. WSL copies are historical rollback
evidence, not an execution dependency. A separately authorized recovery may
consult that evidence, but routine AP2 work must not recreate the retired bridge
or depend on a human workstation.

## Current identity boundary

`AP2 Simulated User CBA` is the standing eligibility group for the enabled X.509
authentication-method policy. The retained simulated users use their exact
Microsoft mappings and certificates from the protected runtime. Actor-specific
work must still select the user whose attribution and evidence matter.

The broad Dev/Graph identity remains a development and diagnostic tool. It is
not a substitute for delegated user execution when Microsoft or Windows must
record a specific simulated user.

## Readiness

Install repository dependencies with `npm ci`, then run:

```sh
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
