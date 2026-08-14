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

## One-time inventory and placement

Copy only the authoritative standing artifacts below. Preserve the source
filenames and certificate/key identity. Record each destination-relative name,
type, byte count, and SHA-256 in owner-only `migration-inventory.json`; compare
the source and destination hashes without printing file contents.
After the byte-for-byte copy and hash comparison, update only absolute path
fields in sanitized user records and protected Dev config to their durable
destinations, then record the post-update hashes. Do not change IDs, SKIs,
certificate bytes, keys, or passphrases.

| Class | Required standing material | Durable destination |
| --- | --- | --- |
| Secret | Lisa issuer encrypted private key and its passphrase reference | `secrets/cba/issuer/` |
| Secret | Cory, Homer, Kobe, and Marge encrypted private keys, key passphrases, PFX files, and PFX passphrases | `secrets/cba/users/<alias>/` |
| Secret | Dedicated SPA operator PFX and passphrase | `secrets/cba/operator/` |
| Secret | Dev/Graph credential PEM and protected config | `secrets/dev-graph/` |
| Public instance metadata | Issuer, leaf, operator, and Dev public certificates plus sanitized per-user records | Beside the related protected material; the runtime remains owner-only |
| Reproducible non-secret | Playwright version/image pin, no-call readiness code, and deterministic WAV generator | Canonical AP2 Git |

Do not migrate WSL `node_modules`, browser caches, cookies, storage state,
screenshots, old run directories, or `graph-admin/live-testing-lock.json`.
Historical readiness scripts are stale residue when their useful behavior is
already in canonical AP2 code.

Before copying, reconcile both ambiguous 2026-08-14 operations on ravioli:

- inspect `/tmp/ap2-cba-renew-20260814` and any related `openssl` process; treat
  it as W20 temporary output, never as an authoritative certificate source;
- inspect every
  `/home/west/.config/after-party/teams-voicemail-plan-b-20260814.*` directory;
  retain or remove it only after determining whether the call-free staging
  command completed.

Authoritative sources are the established `cba-proof`, `user-simulator`,
`spa-operator`, and `graph-admin` standing directories under
`/home/west/.config/after-party`, not either temporary location above. Keep the
WSL originals as rollback evidence after validation.

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

`npm run check:durable-runtime -- --browser-only` proves the pinned browser and
fake-microphone layer before secrets arrive; it is not evidence that migration
or CBA identity readiness is complete. The full command is the resume gate for
W20/W23-class work.
