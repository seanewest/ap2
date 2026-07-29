# Windows host static boundary

Sean's shared Windows host is not an AP2 execution target. The repository
includes a deterministic static check that prevents local runtime and
automation code from adding Windows-host process bridging or desktop
automation.

Run it directly:

```sh
npm run check:windows-host-boundary
```

The check reads Git index metadata without starting Git or another child
process. It then reads tracked executable text by a fixed extension set,
executable Git mode, nested Dockerfile name, and named root runtime
configuration files. Documentation, declarative infrastructure templates,
protected evidence, fixture data, dependencies, and build output are outside
that exact surface policy. Unsupported split, sparse, conflicted, or submodule
index state fails closed. Only the inert signature catalog and fixture data are
exact self-test exclusions; the checker, CLI, and executable tests remain
scanned.

The checker never reads a Windows mount and never executes candidate text. It
rejects Windows executables and shells, executable `/mnt/c` targets, WSL
process bridging, Windows application-package launch, and shared-host GUI,
input, clipboard, or desktop-session automation. Detection is
case-insensitive and compacts quoting and generated-string separators so
indirect launch arguments do not evade the boundary. Browser-owned Playwright
screenshots and web clipboard APIs remain valid because they operate within an
isolated browser context and do not bridge to the shared desktop.

Output is bounded JSON. A pass reports only the scanned-file count. A failure
reports only repository-relative file names and fixed categories, never the
matched source text. Exit code `1` means a policy finding; exit code `2` means
the bounded scan itself failed closed.
