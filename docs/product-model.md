# Capability, scenario, and lab vocabulary

AP2 needs three separate concepts. Previous work blurred them and created too
much learner-oriented architecture during a stage that was still technical
exploration.

## Capability

A **capability** is one action or observation AP2 can perform with a known
boundary and an honestly described result.

Examples include:

- create or cancel a calendar event;
- send or observe a message;
- place or receive a Teams call;
- create, change, share, inspect, or remove a file;
- change an identity, application, endpoint, or Azure resource;
- observe an audit, security, or administrative signal;
- reconcile whether a previous action or cleanup completed.

A capability may be proven through a development identity before the eventual
product identity exists. The evidence should say what was actually proven and
what was not.

A capability does not automatically require a learner, lesson, generalized
manifest, hosted API, primary SPA control, receipt adapter, or production-grade
reset path.

## Scenario

A **scenario** combines capabilities to create coherent incident-like state.
For example, a scenario might combine suspicious sign-in activity, document
changes, Teams communication, and data access so the tenant resembles a
credential-theft or exfiltration incident.

At the current stage, scenario work is technical composition:

- can the actions coexist;
- do their identities and timing make sense;
- what evidence appears;
- what must be staged in sequence;
- what can be reset afterward.

A scenario is useful even when no student instructions, teaching content, or
assessment exists.

The repository currently contains code named `scenario` and schema-v2 scenario
manifests. Those are experimental technical contracts created during Pass 3.
They may remain useful, but their existence does not make learner-lab design the
project's current objective and does not require every new capability to adopt
them.

## Lab

A **lab** is a future educational product built around a scenario. It may define
learning objectives, investigation steps, teaching material, learner choices,
permitted responses, assessment, and completion.

AP2 is not currently trying to define the universal lab contract. When lab
authoring becomes a goal, Sean will request it explicitly.

Existing learner-role parsers, fixtures, documents, or UI experiments should be
read as historical prototypes, not standing instructions to expand learner
architecture.

## Baseline and disposable state

The retained AP2 control plane spans the Product and Student tenants. The Product
tenant owns the multitenant app registration and API resource. The Student
tenant owns the local service principal, development automation identity, API
and managed identity, standing authority, simulated-user identities, licensing,
authentication setup, and selected baseline configuration. These must survive
ordinary capability and scenario cleanup.

For simulated users, preserve identity and access setup but distinguish it from
workload state. Mail, calendar entries, files, Teams activity, temporary group
membership, and scenario-created permissions are disposable or resettable.

Standing development permissions are baseline. Pass 3 should not repeatedly
remove and restore them unless the permission itself is under investigation or
the intended architecture changes. Explicitly temporary grants remain part of
the scenario lifecycle. Broad authority never justifies placing secrets or
privileged credentials in the SPA.

Capability and scenario runs add disposable state around that control plane.
Reset is likely to be staged and workload-specific because Microsoft 365 lacks
an Azure-style universal resource container. Propagation delay, retention,
audit history, recoverable deletion, and partial cleanup are expected platform
properties.

The useful question is whether the sandbox is ready enough for the next run,
not whether every historical trace disappeared.

## Evidence language

Use plain evidence levels:

- **observed:** directly seen in Microsoft or the product path;
- **inferred:** a reasonable explanation supported by observations;
- **unknown:** not yet tested or not distinguishable with the current evidence.

Do not create a stronger contract merely to avoid saying that something remains
unknown.
