# Manual-only operator panel accessibility audit

This audit covers every authenticated manual-only operator panel in the local
SPA. It runs through the signed Linux-headless product path and makes no tenant,
cloud, workload, or Windows-host request.

| Panel | Deliberate action | Measured interaction boundary |
| --- | --- | --- |
| Recent operations | Refresh recent operations | No automatic read, named region/action, disabled and busy loading state, fixed safe failures |
| Scenario catalog | Use in plan preview | Local-only keyboard action, described action, deterministic focus transfer, no request |
| Scenario surface availability | None | Semantic caption/table/headings, focusable narrow-viewport scroll region, fixed status legend, no request or action |
| Scenario plan preview | Preview plan | Named controls, local validation, busy/disabled form, focused live result/refusal, stale replacement |
| Scenario batch feasibility | Evaluate feasibility | Named controls, local validation, busy/disabled form, focused live result/refusal, stale replacement |
| Receipt verification | Verify receipt | Described input, local validation, busy/disabled form, focused live result/refusal, stale replacement |
| AVD rehearsal verification | Verify rehearsal output | Described input, local validation, busy/disabled form, focused live result/refusal, stale replacement |
| Private-document rehearsal verification | Verify private-document rehearsal | Described input, local validation, busy/disabled form, focused live result/refusal, stale replacement |
| Help-desk email rehearsal verification | Verify help-desk rehearsal | Described input, local validation, busy/disabled form, focused live result/refusal, stale replacement |
| Teams missed-call rehearsal verification | Verify Teams rehearsal | Described input, local validation, busy/disabled form, duplicate blocking, focused live result/refusal, stale replacement |
| Application-reconnaissance rehearsal verification | Verify application-reconnaissance rehearsal | Described input, local validation before authorization, busy/disabled form, duplicate blocking, focused fixed result/refusal, stale replacement |

The shared browser audit fixes the viewport at 320 CSS pixels, requests reduced
motion, checks region and action names, verifies control-before-submit keyboard
order, confirms live output regions, exercises local validation and focus with
the keyboard, and proves zero manual API requests before a deliberate
request-producing action. Existing signed product-path tests separately cover
success, fixed 401/403 and bounded failure states, loading suppression, and
stale-result replacement.

The audit found two small consistency defects. Receipt and AVD verification
disabled Submit while loading but did not expose `aria-busy` on their forms.
Plan preview exposed its result as a live region but did not make or focus that
region after a deliberate success or refusal. The corrections reuse the
semantics already present in the batch and private-document panels. They add no
route, request, retry, polling, persistence, scheduling, execution, or external
effect.
