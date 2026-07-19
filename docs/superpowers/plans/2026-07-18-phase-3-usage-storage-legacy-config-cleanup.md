# Usage Storage and Legacy Config Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move provider usage persistence to Pi's agent cache directory and remove legacy config filename fallbacks without changing live config parsing or extraction behavior.

**Architecture:** Reuse Pi's existing getAgentDir() resolver for the usage file. Keep both live config loaders and their validators, but make each recognize only the current filenames; remove only the obsolete fallback paths and related tests.

**Tech Stack:** TypeScript, Node.js fs/path, @earendil-works/pi-coding-agent, Vitest, Biome, pnpm.

---

### Task 1: Move default usage persistence to Pi's cache directory

**Files:**

- Modify: tests/providers/persistence.test.ts
- Modify: src/providers/registry.ts

- [ ] **Step 1: Add a failing default-path test**

In tests/providers/persistence.test.ts, add this test inside the existing createFilePersistence block. Keep the explicit-path tests unchanged.

    it("uses Pi's agent cache directory by default", () => {
      vi.stubEnv("PI_CODING_AGENT_DIR", "/tmp/pi-agent");
      const adapter = createFilePersistence();

      adapter.save({ brave: { count: 10, month: "2026-07" } });

      expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/pi-agent/cache/pi-tools", {
        recursive: true,
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        "/tmp/pi-agent/cache/pi-tools/usage.json",
        JSON.stringify({ brave: { count: 10, month: "2026-07" } }, null, 2),
      );
    });

Add vi.unstubAllEnvs() to the existing afterEach so the environment override cannot leak between tests.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: pnpm vitest run tests/providers/persistence.test.ts

Expected: the new test fails because the default path still points to the old home-directory location.

- [ ] **Step 3: Use Pi's existing directory resolver**

In src/providers/registry.ts:

1. Add import { getAgentDir } from "@earendil-works/pi-coding-agent";.
2. Remove the node:os import.
3. Change createFilePersistence to compute its default path as:

   const usagePath = filePath ?? path.join(getAgentDir(), "cache", "pi-tools", "usage.json");

Do not add a migration, old-file read fallback, old-file deletion, or a new path helper. Preserve the current JSON format, parent-directory creation, and best-effort error handling.

- [ ] **Step 4: Run the persistence suite and verify it passes**

Run: pnpm vitest run tests/providers/persistence.test.ts

Expected: all persistence tests pass, including the default-path assertion.

- [ ] **Step 5: Commit the storage change**

  git add src/providers/registry.ts tests/providers/persistence.test.ts
  git commit -m "refactor: move usage persistence into pi agent cache"

### Task 2: Remove legacy config filename fallbacks

**Files:**

- Modify: src/config.ts
- Modify: tests/config.test.ts

- [ ] **Step 1: Add failing tests for single-path global loading**

In tests/config.test.ts, import getConfigPath alongside the existing config exports. Add one test inside the loadConfig describe block and one inside the loadMergedConfig describe block.

    it("does not read a second global config path", () => {
      const currentPath = getConfigPath();
      vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
        const resolved = typeof filePath === "string" ? filePath : filePath.toString();
        if (resolved === currentPath) throw new Error("ENOENT");
        return JSON.stringify({ defaultProvider: "unexpected" });
      });

      expect(loadConfig().defaultProvider).toBe("auto");
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

Use the same test body in the loadMergedConfig block, replacing the final assertion with:

    expect(loadMergedConfig().defaultProvider).toBe("auto");

The tests intentionally do not name the removed filename; the one-call assertion proves no fallback read occurs.

- [ ] **Step 2: Update project-discovery tests and remove only legacy expectations**

In the findProjectConfigPath tests:

1. Keep the current .pi/tools.json local, ancestor, missing, root, and depth cases.
2. Remove tests whose only purpose is discovering .pi/pi-tools.json or preferring it.
3. Change the depth assertion from at most 20 calls to at most 10 calls.
4. Change the /a/b root-walk assertion from 6 calls to 3 calls.

In the loadMergedConfig tests:

1. Change project fixtures that use the legacy filename to .pi/tools.json.
2. Remove the test that expects a legacy global fallback.
3. Keep all tests for global loading, project-over-global merging, project-over-default merging, trust filtering, and default preservation.

Do not remove the loadConfig parser/validator tests or the dedicated tests/config-ssrf.test.ts, tests/config-deep-research.test.ts, and tests/extract/config-video.test.ts suites. Production extraction code still calls loadConfig().

- [ ] **Step 3: Run the config suite and verify the new tests fail**

Run: pnpm vitest run tests/config.test.ts

Expected: the new single-path assertions and reduced project-discovery call counts fail against the current fallback implementation; unrelated config tests continue to pass.

- [ ] **Step 4: Remove only the obsolete fallback branches**

In src/config.ts:

1.  Delete getLegacyConfigPath().
2.  Change loadConfig's default path list from [getConfigPath(), getLegacyConfigPath()] to [getConfigPath()]. Keep its custom configPath behavior, JSON parsing, validation, and syntax-error handling unchanged.
3.  Delete LEGACY_PROJECT_CONFIG_RELATIVE.
4.  Simplify findProjectConfigPath to one candidate per directory:

    export function findProjectConfigPath(startDir: string): string | undefined {
    let dir = path.resolve(startDir);
    for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const candidate = path.join(dir, PROJECT_CONFIG_RELATIVE);
    if (fs.existsSync(candidate)) return candidate;

        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;

    }
    return undefined;
    }

5.  Update the project-discovery comment to mention only .pi/tools.json.
6.  Replace the global fallback loop in loadMergedConfig with one best-effort read of getConfigPath():

    try {
    merged = deepMerge(
    merged,
    JSON.parse(fs.readFileSync(getConfigPath(), "utf-8")) as Record<string, unknown>,
    );
    } catch {
    // Missing or malformed global config — keep defaults.
    }

7.  Update the loadMergedConfig comment to describe the current global and project paths only.

Leave parseConfigFile, validateSsrfConfig, validateCombineConfig, validateDeepResearchConfig, trust filtering, and deep-merge behavior intact.

- [ ] **Step 5: Run all config-related tests and typecheck**

Run:

    pnpm vitest run tests/config.test.ts tests/config-ssrf.test.ts tests/config-deep-research.test.ts tests/extract/config-video.test.ts
    pnpm typecheck

Expected: all config and extraction tests pass, and TypeScript reports no errors.

- [ ] **Step 6: Commit the config cleanup**

  git add src/config.ts tests/config.test.ts
  git commit -m "refactor: remove legacy config fallbacks"

### Task 3: Update current documentation and verify the complete change

**Files:**

- Modify: README.md
- Modify: CHANGELOG.md

- [ ] **Step 1: Remove the current README compatibility claim**

In the configuration section of README.md, replace the existing paragraph with:

    The global config is ~/.pi/agent/extensions/tools.json. A project .pi/tools.json overrides it. Pi Tools deep-merges project settings, global settings, and built-in defaults in that order.

Do not add usage-file migration instructions; the approved behavior is a clean cutover.

- [ ] **Step 2: Record the current behavior in the Unreleased changelog**

Under ## [Unreleased], add these bullets to the existing ### Changed and ### Removed sections:

    - Provider usage persistence now lives at $PI_CODING_AGENT_DIR/cache/pi-tools/usage.json.
    - Removed legacy pi-tools.json config filename fallbacks.

Keep the historical 0.2.0 changelog entry and archived implementation plans unchanged.

- [ ] **Step 3: Run the complete verification suite**

Run: pnpm check

Expected: Biome lint passes, TypeScript typecheck passes, and the full Vitest suite passes.

- [ ] **Step 4: Review the diff and confirm the cleanup boundary**

Run:

    git diff --check
    git diff --stat

Confirm the implementation diff is limited to the two source boundaries, their focused tests, README.md, and CHANGELOG.md. Confirm there is no migration code, no new path abstraction, no removal of live config parsing, and no unrelated dead-code refactor.

- [ ] **Step 5: Commit the documentation and final verification**

  git add README.md CHANGELOG.md
  git commit -m "docs: document config and usage storage cleanup"

## Self-review checklist

- The live loadConfig() API and all callers remain intact.
- Usage persistence uses Pi's agent directory and keeps the existing explicit-path test seam.
- Both config loaders recognize only the current filenames.
- Legacy fallback behavior is covered by failing-then-passing regression tests without preserving legacy compatibility code.
- No usage JSON schema, provider registration, trust filtering, or config validation behavior changes.
- The work is one delivery phase with three reviewable commits; separate PRs are unnecessary.
