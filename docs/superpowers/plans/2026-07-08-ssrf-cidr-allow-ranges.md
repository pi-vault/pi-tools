# SSRF CIDR Allow-Ranges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CIDR allow-ranges and extended blocked IP ranges to pi-tools' SSRF guard, ported from pi-web-access.

**Architecture:** Pure-function CIDR parsing/matching added to `src/utils/ssrf.ts`. Extended blocked ranges (0/8, CGN, benchmarking, multicast, full IPv6). Config integration via `ssrf.allowRanges` in `PiToolsConfig`. Callers thread `allowRanges` from config into `validateUrl`.

**Tech Stack:** TypeScript, Vitest, Node.js `net` module (for `net.isIP()`)

---

## Phases

This plan is split into 3 atomic phases, ordered simplest → most complex. Each phase produces a working, testable result.

| Phase | Scope                                                    | Deliverable                                            |
| ----- | -------------------------------------------------------- | ------------------------------------------------------ |
| 1     | CIDR parsing + matching                                  | New utility functions + tests. No behavior change.     |
| 2     | Extended blocked ranges + `allowRanges` in `validateUrl` | Stronger SSRF guard with escape hatch. Self-contained. |
| 3     | Config integration + caller threading                    | Wires `allowRanges` from config into tools/providers.  |

Phase plans:

- `docs/superpowers/plans/2026-07-08-ssrf-cidr-phase-1-parsing.md`
- `docs/superpowers/plans/2026-07-08-ssrf-cidr-phase-2-blocked-ranges.md`
- `docs/superpowers/plans/2026-07-08-ssrf-cidr-phase-3-config-wiring.md`

---

## File Map

| File                            | Action | Responsibility                                                                   |
| ------------------------------- | ------ | -------------------------------------------------------------------------------- |
| `src/utils/ssrf.ts`             | Modify | Add CIDR types, parsing, matching, extended blocked ranges, `allowRanges` option |
| `src/config.ts`                 | Modify | Add `SsrfConfig` interface, add `ssrf` to `PiToolsConfig`, add default           |
| `src/extract/pipeline.ts`       | Modify | Add `allowRanges` to `ExtractOptions`, pass to `validateUrl`                     |
| `src/tools/web-fetch.ts`        | Modify | Accept `ssrfAllowRanges` param, pass to `extractContent`                         |
| `src/providers/searxng.ts`      | Modify | Accept `allowRanges` in options, pass to `validateUrl`                           |
| `src/index.ts`                  | Modify | Pass `configManager.current.ssrf.allowRanges` to tool/provider factories         |
| `tests/utils/ssrf-cidr.test.ts` | Create | CIDR parsing, matching, validation tests                                         |
| `tests/utils/ssrf.test.ts`      | Modify | Add extended blocked range tests, `allowRanges` integration tests                |
