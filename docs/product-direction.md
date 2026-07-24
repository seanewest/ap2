# AP2 Product Direction and Pass 3 Charter

> This document provides context, not a backlog.
>
> It does not authorize agents to implement future ideas. The current task from Sean or Captain always defines the actual scope. Do not build something merely because it appears in this document.

## Ultimate product direction

The eventual product is a cybersecurity learning platform.

A student connects a Microsoft 365 and Azure tenant. Each lab creates a controlled, realistic scenario inside that tenant—possibly based on a real security event—and teaches the student how to detect and respond using the same tools they would use in practice.

The learning experience may eventually include:

1. Creating controlled activity inside the student's tenant.
2. Letting the student investigate that activity with real Microsoft tools.
3. Providing video or other educational material explaining detection and response.

Before building the educational content, we need to understand how to build the underlying tenant automator or simulator.

## The simulator we are exploring

The simulator may eventually need to perform actions such as:

- Creating or configuring Azure resources.
- Creating controlled Microsoft 365 user activity.
- Simulating ordinary user behavior.
- Changing selected security settings.
- Producing events that security tools can detect.
- Verifying or restoring tenant state after an experiment.

We do not yet know the complete list of safe or practical operations.

An important part of the exploration is learning Microsoft's boundaries. Some activity may be unsafe, unrealistic, prohibited, or likely to trigger abuse protections. For example, repeatedly causing failed sign-ins or attempting to simulate denial-of-service activity would not be appropriate.

We should begin with small, controlled actions and learn from real results.

## What Pass 3 is for

This repository is the third exploratory pass. It is intentionally disposable.

Pass 3 has two purposes:

1. Explore what Microsoft 365 and Azure activity can be automated or simulated, how it works, and what limitations we encounter.
2. Improve Sean's workflow for directing and collaborating with LLM agents.

The implementation may eventually be thrown away and rebuilt in another pass. That is expected, not a failure.

During Pass 3, the rehearsal API may be kept warm as needed because development speed and exploration take priority over minimizing hosting cost. Later passes should revisit student-borne hosting cost, scale-to-zero behavior, and SPA timeout and user messaging when the API is cold. Do not build cold-start or cost-control machinery solely for those concerns in Pass 3.

## Pass 3 identity and permission posture

The Dev app is a development and test identity for Pass 3. It will never be installed, consented, or present in a real student's tenant. It may directly query or manipulate Microsoft services for development and diagnostics.

During this exploratory pass, the human operator, backend/API automation identity, Dev app, and shared simulated-user client should receive broad permissions appropriate to exploration so work is not repeatedly blocked by least-privilege decisions. Production hardening and least-privilege review are deferred to a later pass.

Broad permissions do not erase actor boundaries. The operator uses the SPA/API, backend administrative operations use the API/backend identity, and activity intended to appear as a simulated user uses that user's delegated identity.

Pass 3 should minimize app identities and registrations. Reuse one identity where the actor and authentication model are the same, and create another only for a genuinely distinct actor or authentication flow. The current shared simulated-user client is an Entra OAuth client used to acquire delegated tokens for simulated users; it is not a process, worker, or long-running job, and it is shared rather than created per user.
