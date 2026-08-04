# Historical SharePoint document-change lab-readiness audit

> **Status:** This document records a past detour into learner-lab design. Its
> capability evidence remains useful, but none of the missing learner pieces is
> current work. Revisit educational design only when Sean explicitly requests
> it. See [the current product direction](product-direction.md).

## What the audit established

AP2 has historical proof that a harmless SharePoint file can be created,
overwritten, inspected through version history, restored, and removed. A
separate detector later returned Purview records attributing operations to the
producer application.

Those are useful capability conclusions. They came from diagnostic canaries and
did not form one repeatable product path.

## Why the proposed lab was not complete

At the time, the repository did not provide one connected learner-facing path
that staged the file, presented safe version and attribution evidence, recorded
a learner decision, performed an authorized response, and proved terminal
cleanup. Runtime validation of a proposed Lab card would not have supplied that
missing external behavior.

That conclusion should not be read as a backlog. The project is currently
exploring capabilities and technical scenarios, not completing this lab.

## Capability facts that remain useful

- The fixed hosted SharePoint proof remains a create/remove capability.
- The trusted-version lifecycle owns a source-backed overwrite and
  version-history path with active cleanup.
- Historical restoration was an unconditional diagnostic recovery action, not
  proof of a learner-authorized response.
- Purview evidence proved operation-level producer attribution for the retained
  records that were inspected. It did not prove content collection, learner
  visibility, or every SharePoint operation.
- Existing manifests, rehearsals, receipts, and briefing prototypes are optional
  experimental machinery. Their presence does not require further lab work.

## Current use

Use these facts when exploring SharePoint tampering, audit attribution, scenario
composition, or reset behavior. Do not add learner briefings, completion
receipts, lab cards, restoration pedagogy, or composite lab envelopes unless a
new explicit goal asks for educational design.
