# AP2 product direction and current exploration

## Long-term direction

The eventual product may provide cybersecurity labs in a Microsoft 365 and
Azure tenant dedicated to training. A lab could stage realistic activity, let a
student investigate it with real security tools, and support teaching or
assessment around what happened.

That long-term idea is a direction, not the current backlog.

## Current stage

AP2 is still mapping what is technically possible and useful. The immediate
work is to learn which actions and observations can be performed reliably,
which identities and transports they require, what Microsoft records, how long
state takes to appear, and how practical reset is.

Examples include:

- creating, changing, observing, and removing Microsoft 365 content;
- producing user, application, identity, endpoint, and infrastructure activity;
- observing security, audit, and administrative evidence;
- composing several actions into incident-like tenant state;
- exploring endpoints, SaaS connections, Azure resources, applications,
  Kubernetes, attack paths, and other surfaces that have barely been tested.

There is far more platform exploration to do before AP2 needs a general model
for teaching, learner roles, lesson flow, assessment, or publishable labs.
Those topics should be worked on only when Sean explicitly asks for them.

## Capability, scenario, and lab

A capability is one repeatable action or observation. A scenario is a technical
composition of capabilities that creates a useful incident-like state. A lab is
a later educational experience built around a scenario.

Current work is mostly capabilities and early scenario composition. A scenario
can be valuable even when no learner workflow has been designed.

See [the product vocabulary](product-model.md) for the fuller distinction.

## Dedicated sandbox model

The fixed Student tenant currently used by AP2, and any future student-provided
tenant used by the product, are dedicated sandboxes. They should not contain
personal or production work.

The current architecture places AP2's development and execution infrastructure
inside the Student tenant. That tenant-resident control plane includes the
application and service-principal identities, development automation identity,
API and its managed identity, required permissions, simulated users, licensing,
and selected configuration needed to operate AP2. Preserve it by default. It is
infrastructure, not scenario residue, even though it lives inside the sandbox.

A different product could centralize more of that control plane in a separate
provider tenant, but that is a different architecture and not a current goal.
Microsoft365DSC or similar tooling may eventually help describe and restore the
retained tenant baseline.

Scenario state—messages, meetings, files, calls, temporary permissions, marked
resources, security signals, and other staged activity—is disposable. Azure can
often be reset through resource-group deletion. Microsoft 365 usually requires
workload-specific cleanup, and both creation and cleanup may take time to
propagate. Historical audit, retention, recycle-bin, and deleted-object residue
may remain.

A useful reset returns the sandbox to a state where another experiment can run.
It does not need to prove that Microsoft restored an exact previous snapshot.

## Pass 3

This repository is the third exploratory pass of After Party despite the `ap2`
name. Earlier passes were discarded and restarted. This pass should preserve
useful code and evidence while remaining willing to remove mistaken
architecture and rewrite accumulated guidance.

Pass 3 has two purposes:

1. learn the available technical medium across Microsoft and connected security
   systems;
2. improve the way Sean collaborates with agents while doing that exploration.

Optimize for learning and feedback speed. Prefer one decisive live experiment
over a generalized framework. Add durable product architecture only after
repeated work reveals a stable need.

## Real boundaries

Broad exploratory permissions are acceptable inside the dedicated sandbox when
they reduce friction. Actor identity still matters when the experiment is meant
to appear as a specific user, application, or device.

Protect credentials, administrative recovery, systems outside the sandbox,
public exposure, service-abuse limits, and spending. Do not confuse those real
boundaries with preservation of disposable tenant state.
