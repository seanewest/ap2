# Primary SPA surface inventory

The signed-in AP2 page is a human product surface, not a developer console.
This inventory records the deliberate boundary after the usefulness review.

| Surface family | Primary SPA status | Human purpose and consequence |
| --- | --- | --- |
| Microsoft authentication | Kept | Sign in to AP2 or end the current AP2 session. |
| Lab catalog | Kept, read-only | Shows only complete learner experiences. It honestly reports that none are published yet. |
| Capability building blocks | Kept, read-only | Explains tested ingredients and their proof limits without presenting them as labs. |
| Microsoft 365 capability actions | Kept | Each button names the exact email, file, meeting, contact, rule, category, draft, or task change it makes. Reversible proofs have separate named cleanup actions; email actions plainly state that no cleanup action exists. |
| API access and rehearsal diagnostics | Removed | Health and authorization diagnostics remain covered by API, container, and automated tests. |
| Recent operation telemetry | Removed | Telemetry contracts, collectors, and tests remain available outside the primary UI. |
| Plan preview and batch feasibility | Removed | Compilers, API routes, clients, CLIs, and tests remain reusable without exposing orchestration forms to users. |
| Receipt and rehearsal verification | Removed | Validators, authenticated APIs, typed clients, offline CLIs, fixtures, and tests remain authoritative. The SPA no longer asks users to paste JSON or historical PR envelopes. |
| Scenario surface matrix | Removed | The network-free `check:scenario-surfaces` command remains the repository inventory. |
| Learner briefing projection | Removed | The pure briefing builder remains tested, but no incomplete workflow enters it from the SPA. |
| Failed-rehearsal support bundle | Removed | Fixed API support references remain available in safe error messages; the UI-only bundle/export path was deleted. |

The main page contains no textarea, raw JSON input, `REHEARSAL_ONLY` verifier,
PR-number instruction, internal contract matrix, or debug/export control.
Rendering the signed-in page performs no API request. Repository support does
not imply live platform proof, learner visibility, cleanup, or lab completion.

The retained mutation controls are capability demonstrations rather than
published labs. Their notices state the real tenant effect, actor, target, and
whether cleanup is available before the user chooses an action.
