# Capabilities and learner labs

AP2 has two different product concepts:

- A **capability building block** is one bounded, reusable operation or
  observation contract. It may prove that AP2 can stage, observe, reconcile, or
  clean up one kind of evidence. It is an ingredient, not a complete learner
  experience.
- A **lab** is a deliberately authored learning experience that connects
  multiple building blocks into one coherent story, evidence chain,
  investigation, and completion model.

The existing schema-v2 scenario manifests are orchestration contracts for
capability building blocks. Their internal evidence-producer, workload-actor,
trigger, permission, retention, cleanup, expiry, and cost fields remain
important to safe execution and verification. Those fields are not learner
content and are not displayed as if they were a lab narrative.

## Minimum complete-lab contract

A publishable lab must define:

1. a coherent story and learning objective;
2. one human learner and their responsibility;
3. simulated people, applications, devices, evidence recipients, detectors,
   and responders that remain distinct from that human learner;
4. a connected evidence chain using at least two distinct capability building
   blocks;
5. what the learner can observe and why each observation matters;
6. an investigation prompt;
7. permitted learner actions; and
8. completion criteria.

`parseLearnerLabDefinition` validates this learner-facing shape at runtime and
fails closed for unknown fields, actor conflation, a single or duplicate
building block, unknown capability references, or missing learner actions and
completion criteria.

The product Lab catalog is intentionally empty. No current capability manifest
meets the complete-lab contract, and AP2 does not infer a lab from a plan,
receipt, rehearsal, live canary, or collection of nearby features.

## Actor language

The **human learner** is the person reasoning about the evidence. Kobe, Cory,
Homer, Marge, fictional producer accounts, recipient mailboxes, applications,
devices, detectors, and responders are story identities or systems. A human
may use a fictional account or workspace, but the account is not itself the
learner.

The capability catalog therefore shows only:

- that an entry is a building block, not a lab;
- the human-learner boundary;
- the expected evidence recipient or workspace;
- simulated story accounts;
- the evidence type and learner-facing observation; and
- the current proof limitation.

Planning, receipt verification, rehearsal verification, retention, and cleanup
contracts remain available through reusable APIs, clients, CLIs, and automated
tests. They are not controls in the primary SPA. The signed-in page keeps only
the honest catalogs and plainly described real capability actions; see the
[primary SPA surface inventory](spa-surface-inventory.md).

## Future lab boundary

A future investigation might correlate several different signals into one
private-file exfiltration story. That example clarifies why a lab needs a
connected evidence chain and an intentional learner decision. It is not a
published AP2 lab, and this repository does not claim that its possible
signals, pedagogy, or end-to-end execution are complete.

The proposed
[unexpected SharePoint document-change investigation](sharepoint-document-change-lab-readiness.md)
has also been audited against the complete-lab boundary. Its historical
overwrite, recovery, and audit-attribution conclusions do not yet connect
through a repeatable learner-visible product path, so it is not published.
