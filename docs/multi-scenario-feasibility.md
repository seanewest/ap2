# Multi-scenario feasibility planner

The local feasibility planner evaluates a bounded batch of already compiled
canonical scenario plans. It recomputes each plan through the scenario-plan
compiler, sums every declared maximum without discounts, and checks the whole
requested session against every plan's budget and expiry contract.

The planner is deliberately conservative: every selected plan counts toward
the maximum concurrency at once. It does not construct a schedule or claim
that workers, quota, capacity, identities, cloud resources, or human
participants are available.

The session envelope contains a fixed UTC start, positive duration, aggregate
USD ceiling expressed as a two-decimal string, concurrency limit, minimum
expiry margin, and either an `allow` or `refuse` human-gate policy. Every plan
instance has a short sanitized alias. Repeating one scenario is allowed only
with distinct aliases.

The result contains only the exact plan and human-gate counts, conservative
aggregate USD ceiling, maximum concurrency, requested duration, earliest
expiry margin, and ordered categorical blockers. Unknown cost or duration is
infeasible. Cost arithmetic uses integer cents.

## Authenticated in-memory API

Operators may submit a bounded batch to
`POST /api/multi-scenario-feasibility`. Each batch item contains a sanitized
instance alias and the same planning request accepted by
`POST /api/scenario-plan`; clients do not submit compiled plans. The API
authenticates and authorizes before reading the body, compiles every item
through the authoritative scenario compiler, and then invokes this planner
synchronously in memory.

The typed `HttpAfterPartyApi.calculateMultiScenarioFeasibility` client checks
the bounded request and streams the result under a hard response cap. It
imports only browser-safe contract values; the scenario compiler and
feasibility planner stay in the API bundle.

A returned `feasible` result is conservative planning arithmetic only. The
endpoint does not execute, schedule, reserve, query quota or availability,
persist state, collect telemetry, retry, or authorize scenario work.

Run it with one explicit sanitized JSON file:

```sh
npm run plan:multi-scenario-feasibility -- batch.json
```

The CLI reads at most 1 MiB and performs no network call, retry, scheduling,
execution, persistence, or mutation. A feasible result is planning arithmetic
only; it does not reserve resources or authorize scenario work.
