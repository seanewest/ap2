# Offline API Container Apps deployment artifact

AP2 has one repository-owned declarative artifact path for the main API.
`scripts/api-container-app-deployment-artifact.ts` compiles the exact
`ca-ap2-api` single-replica plan into a bounded Azure Container Apps resource
artifact. It is a pure, network-free compiler and validator. It does not
authenticate, execute Azure commands, run what-if, deploy, retry, or persist
output.

The compiler deliberately consumes
`scripts/fixtures/api-single-replica-plan.json` through PR #146's parser. It
does not copy or reinterpret the scale contract. The second input is one exact
JSON deployment description with:

- the exact target Container App resource ID already owned by the readiness
  contract and a same-subscription managed environment resource ID;
- a system-managed runtime and registry identity selection;
- one immutable ACR image reference ending in a lowercase SHA-256 digest;
- the region;
- four versioned Key Vault secret references for issuer, audience, JWKS URL,
  and the exact CORS origin; and
- bounded marker and owner aliases, a one-day-or-less planned UTC expiry
  window, and zero-incremental-spend metadata.

Missing, extra, malformed, cross-subscription, mutable-image, literal-secret,
or cost/identity/topology drift is refused categorically. Resource IDs,
registry names, image references, Key Vault URLs, aliases, and timestamps are
syntax-bounded inputs. The compiler never accepts a secret value, tenant ID,
credential, token, certificate, request body, arbitrary environment variable,
or executable command.

The emitted resource body fixes:

- system-assigned identity and a system-identity ACR pull reference;
- external HTTPS-only ingress on port 3000;
- single revision mode and `minReplicas=1`, `maxReplicas=1`;
- one immutable image, fixed secret-reference environment bindings, 0.5 CPU,
  and 1 GiB memory;
- liveness and readiness probes on `/health`; and
- a ten-second termination grace period plus bounded marker, owner, expiry,
  and cost tags.

Run the compiler only with two explicit local JSON files:

```sh
npm run compile:api-deployment-artifact -- \
  scripts/fixtures/api-single-replica-plan.json \
  /path/to/sanitized-deployment-input.json
```

The JSON on standard output is review input, not deployment proof or a
deployment instruction. The repository intentionally has no generic executor,
Azure command wrapper, live configuration, or committed environment-specific
deployment input. An external deployment decision must separately authorize
the exact resource and inputs, and the existing ARM readiness read must still
confirm the resulting single-replica topology.

The artifact preserves the currently proven system-assigned API actor. It does
not add a shared operation journal: PR #144 remains only a state-machine
contract, so this compiler cannot justify more than one API replica.
