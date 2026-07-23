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
