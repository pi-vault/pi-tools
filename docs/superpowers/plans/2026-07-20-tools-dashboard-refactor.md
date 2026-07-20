# /tools Dashboard Refactor Implementation Plan — Superseded

> **Status:** Superseded on 2026-07-20. Do not implement from this file.

The refactor is split into four independently releasable plans. They are the authoritative implementation sequence:

1. [Phase 1: Shell and Status](./2026-07-20-tools-dashboard-refactor-phase-1-shell-status.md)
2. [Phase 2: Activity and Widget](./2026-07-20-tools-dashboard-refactor-phase-2-activity-widget.md)
3. [Phase 3: Provider Configuration](./2026-07-20-tools-dashboard-refactor-phase-3-provider-configuration.md)
4. [Phase 4: Provider Tests and Tabs-Only Migration](./2026-07-20-tools-dashboard-refactor-phase-4-tests-migration.md)

Use the approved [design spec](../specs/2026-07-20-tools-dashboard-refactor-design.md) for cross-phase contracts.

This file intentionally contains no duplicate implementation steps. Maintaining the same work in two plans caused stale mode guards, path handling, interaction behavior, and verification commands.
