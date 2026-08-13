# AP2 Coordinator supplement

The generic Coordinator role belongs to `seanewest/codex-agent-tools`. This file contains only AP2-specific coordination guidance.

AP2's active project work may require either the AP2 product repository or the shared AgentTools repository. Product/capability work should execute in AP2; a harness defect or harness feature should execute in AgentTools. The Coordinator should choose the appropriate repository context for the durable worker rather than implementing either change itself.

For AP2 experiments, preserve the established disposable-sandbox/control-plane boundaries in `AGENTS.md`, expect Microsoft propagation waits, and consult `docs/proven-capabilities.md` before assigning work that may already be proven. The Coordinator does not redefine AP2 product direction.
