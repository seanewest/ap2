# Durable AP2 runtime boundary

AP2 browser, CBA, and Dev/Graph automation uses one owner-only protected
development runtime on the durable `work` CT. After the AgentTools redesign it
was restored at:

```text
/home/agent/.local/share/ap2/runtime
```

Fresh workers receive the path-only runtime environment from
`/home/agent/.config/ap2/runtime.env`. AP2 tooling resolves the runtime in this
order: explicit `AP2_RUNTIME_ROOT`, then `$XDG_DATA_HOME/ap2/runtime`, then
`$HOME/.local/share/ap2/runtime`.

The live layout is:

```text
$AP2_RUNTIME_ROOT/
├── secrets/       # standing protected AP2 development material
└── runs/          # disposable outputs; currently empty between runs
```

Reproducible container/browser cache lives separately under
`/home/agent/.cache/ap2/containers`; it is not authoritative credential state.
The runtime is owned by `agent`; protected directories are mode `0700` and
protected files are mode `0600`. Secrets, cookies, browser storage state,
cached interactive sessions, historical run evidence, and machine profiles do
not belong in Git or report output.

## Standing protected material

The protected runtime contains the standing development material used by AP2:

- the Lisa simulated-user CBA issuer material;
- Cory, Homer, Kobe, Marge, and Rachel user certificates, encrypted keys, PFX
  files, passphrase references, and sanitized records;
- the dedicated SPA operator certificate material;
- the Dev/Graph automation certificate and protected configuration;
- public certificates and sanitized metadata beside their protected sources.

Create a fresh nonpersistent browser context from the applicable standing
certificate for each run. Do not preserve cookies or export reusable signed-in
browser state.

Normal development work should use this live runtime. Historical WSL copies,
Proxmox snapshots, and dated backups are recovery sources, not ordinary
execution dependencies. Routine AP2 work must not recreate the retired bridge
or depend on a human workstation.

## Central development copy

The AP2 Central subscription also holds an encrypted-at-rest copy of the
standing development runtime in the RBAC-enabled
`kv-ap2-dev-central-6d8e` Key Vault in `rg-ap2-development`. This is shared
development-secret infrastructure, not a home for per-Student production or
runtime secrets. The vault uses soft delete and purge protection. Its public
endpoint still requires TLS and explicit Entra data-plane authorization; it has
no legacy access policies.

The local runtime above remains the normal source and temporary fallback. An
authorized agent can reconcile the central copy, verify it by using the
retrieved Dev certificate for an ARM read, or restore an exact owner-only copy
into a new directory:

```sh
npm run development-vault -- upload
npm run development-vault -- prove
npm run development-vault -- restore /new/owner-only/ap2-runtime
```

The tool uses the existing Dev certificate when `AP2_ARM_CONFIG` is available
and otherwise uses Azure's supported default credential chain, allowing a new
host to bootstrap after an authorized Azure sign-in or through its assigned
workload identity. It never prints secret values. Restores refuse an existing
target and write directories as `0700` and files as `0600`.

## Current identity boundary

`AP2 Simulated User CBA` is the standing eligibility group for the enabled X.509
authentication-method policy. The retained simulated users use their exact
Microsoft mappings and certificates from the protected runtime. Actor-specific
work must still select the user whose attribution and evidence matter.

The broad Dev/Graph identity remains a development and diagnostic tool. It is
not a substitute for delegated user execution when Microsoft or Windows must
record a specific simulated user.

## Readiness

Fresh AgentTools workers normally inherit `AP2_RUNTIME_ROOT`; an interactive
shell may also source `/home/agent/.config/ap2/runtime.env`. After repository
dependencies are installed, run:

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

The 2026-08-20 restoration validated all 42 live secret-file hashes, the original
migration-inventory anchor, simulated-user chains/keys/PFX files and unique SKIs,
Dev/Graph Graph and ARM read-only authentication, GitHub read access, fresh
Chromium, and deterministic microphone readiness. Later that day AP2 replaced
the expired dedicated SPA operator leaf with a standing certificate under the
existing trusted Lisa CBA issuer. The replacement preserves the operator key and
SKI mapping, is valid through 2027-08-12, and completed a fresh nonpersistent CBA
sign-in through the hosted SPA. The full readiness command is green again.

The initial migration, one-time WSL transfer, certificate renewal, Rachel
addition, and exact validation evidence are retained separately in
[the runtime migration history](durable-runtime-migration-history.md).
