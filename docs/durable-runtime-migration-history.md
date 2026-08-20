# Durable AP2 runtime migration history

This preserves the August 14–16, 2026 migration and validation record for the
owner-only AP2 runtime. It is historical evidence, not the current operating
procedure. See `durable-runtime.md` for the live boundary and readiness command.

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

Rachel was added later from the durable runtime rather than migrated from WSL.
Her standing encrypted key, passphrase references, certificate, PFX, and
protected record are in `secrets/cba/users/rachel/`. They are deliberately not
part of the immutable one-time migration hash inventory.

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

## Certificate and identity validation

The migrated simulated-user issuer and leaves had expired. W27 renewed them
locally with the same protected keys, preserving the issuer SKI, all four leaf
SKIs, and existing Microsoft user mappings. W20 then replaced only the expired
Lisa issuer in Entra's classic CBA trust with the renewed same-key issuer and
proved a fresh Kobe CBA sign-in from this runtime. The operator issuer and Kobe
mapping remained unchanged. W20 did not start or consume W23, and did not use
its call-attempt budget.

On 2026-08-16, live policy inspection confirmed that `AP2 Simulated User CBA`
is a direct include target of the enabled X.509 authentication-method policy;
its membership is the standing simulated-user eligibility gate. Rachel was
already a direct member. AP2 issued her a unique high-affinity SKI leaf under
the existing Lisa issuer, replaced only her unusable prior SKI mapping, and
stored the prior value in her protected record. A fresh nonpersistent run
through the shared simulated-user client returned an RSA/MFA delegated token
and Graph `/me` confirmed Rachel's exact Student identity. The protected proof
and final policy/mapping reconciliation are in
`runs/rachel-cba-baseline-20260816/`.
