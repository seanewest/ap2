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

Run it with one explicit sanitized JSON file:

```sh
npm run plan:multi-scenario-feasibility -- batch.json
```

The CLI reads at most 1 MiB and performs no network call, retry, scheduling,
execution, persistence, or mutation. A feasible result is planning arithmetic
only; it does not reserve resources or authorize scenario work.
