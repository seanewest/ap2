# SPA bundle budget

The production SPA build has one deterministic, repository-owned regression
guard. `npm run build` runs it immediately after Vite emits `dist/` and before
the documentation and server builds add their separate output.
The checker also excludes the exact `gh-docs/` subtree so a standalone check
after the complete build reports the same SPA metrics.

The 2026-07-29 baseline contains three SPA files: one JavaScript chunk, one CSS
asset, and `index.html`. Their combined size is 456,294 bytes uncompressed,
109,665 bytes with gzip level 9, and 91,233 bytes with Brotli quality 11. The
JavaScript entry is the largest file at 445,626 bytes uncompressed, 107,083
bytes gzip, and 89,105 bytes Brotli. The SPA emits no source maps and no other
assets.

The failing raw-output limits deliberately leave normal-change headroom:

- at most 16 emitted files and 8 JavaScript chunks;
- at most 512,000 bytes for any one file;
- at most 550,000 bytes across the SPA; and
- no source maps.

Raw bytes and counts are stable across supported build hosts. Compressed sizes
remain audit evidence rather than thresholds because compressor versions can
change output slightly. The guard detects accidental large assets, source-map
publication, duplicate-chunk growth, and material total growth. It does not
claim that the current chunking is optimal and must not be used to justify
speculative code splitting.
