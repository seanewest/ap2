# Local test concurrency

`npm test` is the canonical full local validation command. It runs the Windows
host boundary check and every Vitest test with normal isolation and file
parallelism.

Vitest otherwise defaults to one fewer fork worker than the machine's reported
parallelism. On the shared 16-thread development host that meant 15 workers per
worktree. Two simultaneous default suites reproduced the recurring failure:
otherwise healthy five-second tests timed out while synchronously waiting for
child Node CLIs during concurrent jsdom transforms and imports. Fixed
CPU-bound Node workers alone did not reproduce it, which distinguishes
test-process oversubscription from a slow assertion or product defect.

The repository caps Vitest at 25 percent of the host's available parallelism
per worktree. That resolves to four workers on the measured 16-thread host and
scales down on smaller hosts. It uses Vitest's existing scheduler and still
runs all files in parallel; it does not serialize the suite, change isolation,
raise timeouts, add sleeps or retries, or weaken assertions. A capped
foreground suite passed while an uncapped peer was active, and two capped peer
suites passed together. A no-contention run took 35.5 seconds versus a
48.7-second measured default baseline, so the cap did not impose a performance
regression.

Under the cap, the five historically affected subprocess/import-heavy files
passed while a full peer suite was active. Three consecutive canonical
`npm test` runs also passed alongside separate capped full peer suites; their
foreground wall times were 78.4, 57.4, and 69.1 seconds, and every peer suite
passed as well.

The ordinary failure contract is unchanged. A real test or hook that exceeds
its existing timeout still fails, child-process exit and output assertions are
unchanged, and `npm test` exits nonzero on either the host-boundary check or any
Vitest failure.
