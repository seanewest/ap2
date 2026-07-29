# API route contracts

`src/api/api-route-contract.ts` is the small authoritative registry for the
public API surface. Each functional method/path appears exactly once with its
authorization order, request/response/error byte limits, side-effect class,
external-call capability, persistence, retry and scheduling policies, and
fixed owner key.

The API server derives preflight and dispatch ownership from these contracts.
The typed client derives its route paths from owner keys, and the browser
evidence ledger records only declared routes. This removes the former
independent path lists while preserving route behavior.

Run `npm run check:api-routes` to emit the stable, sanitized contract matrix.
The command is network-free and exits nonzero if the inventory is invalid.
Tests mutate copies of the inventory to prove that missing or duplicate routes,
unsafe side-effect metadata, invalid bounds, auth/body-order drift, mutation
retries, and persistence or scheduling drift fail closed.

The inventory describes repository contracts only. It is not a deployment
inventory, an executor, or evidence that an API operation ran. `OPTIONS`
preflight behavior is derived from functional routes and is not a separate
operation.
