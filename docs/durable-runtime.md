# Durable AP2 runtime boundary

Ordinary AP2 browser, CBA, and Dev/Graph automation runs on the durable Proxmox
worker as `codex_worker_replacement`. Its private root is:

```text
/var/lib/codex-agent-tools-replacement/worker/ap2-runtime/
├── secrets/       # standing protected AP2 material; directories 0700, files 0600
├── runs/          # disposable outputs; never reusable browser state
└── containers/    # pinned Playwright image storage; non-secret and reproducible
```

The root and everything below it are owned by
`codex_worker_replacement:codex_worker_replacement` and grant no group or other
access. Cookies, storage state, cached interactive sessions, and WSL machine
profiles do not belong here. Create a fresh nonpersistent browser context from
the standing certificate for each run.

The initial migration completed on 2026-08-14. WSL retains the original files
only as rollback evidence; it is not an ordinary execution dependency.

## One-time inventory and placement

The migration copied only the authoritative standing artifacts below. The
owner-only `migration-inventory.json` records each source and destination name,
type, byte count, mode, and SHA-256. Source and destination hashes were compared
before any transformation. Absolute path fields in sanitized user records and
protected Dev config now point to the durable runtime.

| Class | Required standing material | Durable destination |
| --- | --- | --- |
| Secret | Lisa issuer encrypted private key and its passphrase reference | `secrets/cba/issuer/` |
| Secret | Cory, Homer, Kobe, and Marge encrypted private keys, key passphrases, PFX files, and PFX passphrases | `secrets/cba/users/<alias>/` |
| Secret | Dedicated SPA operator PFX and passphrase | `secrets/cba/operator/` |
| Secret | Dev/Graph credential PEM and protected config | `secrets/dev-graph/` |
| Public instance metadata | Issuer, leaf, operator, and Dev public certificates plus sanitized per-user records | Beside the related protected material; the runtime remains owner-only |
| Reproducible non-secret | Playwright version/image pin, no-call readiness code, and deterministic WAV generator | Canonical AP2 Git |

The standing WSL source aliases were `cory`, `homer.simpson`, `kobe`, and
`marge.simpson`; their durable directory names are `cory`, `homer`, `kobe`, and
`marge`. Other WSL user-simulator bundles are not required by the retained AP2
control plane and were not migrated.

Do not migrate WSL `node_modules`, browser caches, cookies, storage state,
screenshots, old run directories, or `graph-admin/live-testing-lock.json`.
Historical readiness scripts are stale residue when their useful behavior is
already in canonical AP2 code.

Before copying, W27 reconciled both ambiguous 2026-08-14 operations on ravioli:

- inspect `/tmp/ap2-cba-renew-20260814` and any related `openssl` process; treat
  it as W20 temporary output, never as an authoritative certificate source;
- inspect every
  `/home/west/.config/after-party/teams-voicemail-plan-b-20260814.*` directory;
  retain or remove it only after determining whether the call-free staging
  command completed.

No related `openssl` process, W20 temporary directory, or W23 staging directory
was present. No W20 paste or W23 call was performed.

Authoritative sources are the established `cba-proof`, `user-simulator`,
`spa-operator`, and `graph-admin` standing directories under
`/home/west/.config/after-party`, not either temporary location above. Keep the
WSL originals as rollback evidence after validation.

### One-time protected transfer

W27 used the human-created reverse SSH bridge from harness-worker local port
`22022` to `west` on ravioli. The worker pulled the exact files over that bridge;
protected bytes were never encoded into command output. The bridge and its key
are temporary migration access, not a normal execution path. The human who
created the reverse session must stop that session, remove its authorized public
key from ravioli, and then remove the worker-side bridge key and pinned
`[localhost]:22022` host entries.

Do not recreate or use this bridge for ordinary AP2 work. A separately
authorized emergency recovery may use WSL rollback evidence, but normal runs use
only the durable runtime.

## Readiness

Install repository dependencies with `npm ci`. The readiness wrapper uses the
same digest-pinned Playwright image as the API container and disables container
networking. It checks owner/mode boundaries, protected migration hashes,
certificate/private-key matches, all four simulated-user PFX passphrases, the
current certificate validity windows, the Dev credential key match, a fresh
Chromium context loaded with Kobe's PFX, and the deterministic fake microphone
against a loopback-only page. It makes no
Microsoft sign-in, paste, call, Graph request, tenant mutation, identity change,
or permission change.

```sh
npm run check:durable-runtime
```

`npm run check:durable-runtime -- --browser-only` proves only the pinned browser
and fake-microphone layer. The full command is the local-material gate for
W20/W23-class work.

The migrated simulated-user issuer and leaves had expired. W27 renewed them
locally with the same protected keys, preserving the issuer SKI, all four leaf
SKIs, and existing Microsoft user mappings. The full local gate passes, but the
renewed issuer has not been installed in Entra. W20 may resume entirely from
Proxmox to perform that separately authorized trust update and its bounded paste
comparison. W23 remains paused until the trust update and a fresh CBA sign-in
prove the renewed chain; its call-attempt budget remains untouched.
