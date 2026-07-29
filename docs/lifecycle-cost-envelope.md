# Lifecycle cost envelope

`compileLifecycleCostEnvelope` is the pure, network-free cost boundary for a
future billable scenario plan. It answers one question: does a conservative
forecast derived from a caller-supplied rate card fit the exact supplied
ceiling and lifecycle window?

It does not query Azure pricing, quota, billing, or any tenant. It does not
store a rate card and has no timeless default prices. The compiler normalizes
and SHA-256-binds each accepted card, so changing any meter produces a new
forecast identity. A successful result is labeled `FORECAST_ONLY`; the ceiling
is classified as a caller-supplied limit and the observed bill remains
`not-observed`.

## Inputs and lifecycle binding

The request contains the exact validated scenario manifest and its canonical
execution plan, one immutable supplied USD rate card, a region, and bounded
usage assumptions. The compiler independently recompiles the plan and rejects
shape or digest drift. The rate card must:

- be effective at the plan's supplied `asOf` time and remain valid through
  expiry;
- match the requested region and USD currency;
- give every meter a bounded SKU, category, billing unit, rate, minimum
  billable quantity, and billing increment; and
- contain no unknown fields or duplicate meter IDs.

Every billable manifest resource must have at least one usage line, and a
usage line cannot target an unowned or nonbillable resource. The plan must
contain an executable marker-bound expiry schedule before each executable
billable create operation. Consequently, a historical pre-seeded proof cannot
be presented as a new cost forecast.

## Conservative timing and cost

The billed lifecycle duration is:

```text
learner duration
+ sum of each sequential provisioning wave's maximum parallel member
+ startup grace
+ cleanup grace
```

Members inside one provisioning wave overlap, while successive waves are
summed. Zero-duration waves are refused. The result must fit inside the plan's
generated-at to expiry window. Resource-hour meters always cover the complete
lifecycle; learner-only hourly billing is not accepted. GB and operation
meters cover bounded fixed usage.

The manifest resource kind fixes both its count and required components: one
personal host and two Linux auxiliaries each require VM compute, OS disk, and
disk-operation meters; one shared NAT resource requires NAT gateway, public
IP, NAT-data, and internet-egress meters. Each component fixes its category and
billing unit. Counts must agree across every meter for that resource, and every
supplied meter must be used. Billing increments and minimums are applied per
resource before multiplying by the exact count. Contingency is then added to
the complete base forecast. The normalized timing and usage profile receives
its own digest alongside the plan and rate-card digests.

The committed three-VM test uses explicitly synthetic `example-*` SKUs and
arbitrary rates to exercise a four-hour learner window, two parallel
provisioning groups, three VMs, disks, shared NAT/IP, bounded data, operations,
grace, and contingency. Those numbers are contract fixtures, not current
Azure prices or a bill.

The older `avd-three-vm-cost.ts` values remain only for byte-compatible
historical runner/rehearsal evidence. New lifecycle forecasts must use a fresh
supplied rate card through this envelope rather than treating that replay
snapshot as current pricing.
