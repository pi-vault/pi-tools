# Phase 7: Config Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename config files from `pi-tools.json` to `tools.json` (and `pi-tools-usage.json` to `tools-usage.json`) with backward-compatible fallback to old names.

**Architecture:** Update filename constants, extract a shared config-parsing helper to avoid duplication, add legacy-path fallback in `loadConfig`, `loadMergedConfig`, and `UsageTracker`, and update all hardcoded path references.

**Tech Stack:** TypeScript 6, Vitest 4, Node 24+ fs APIs

---

## Context

### Source of truth

The config system lives in `src/config.ts`:
- `getConfigPath()` returns `~/.pi/agent/extensions/pi-tools.json` (line 64)
- `PROJECT_CONFIG_RELATIVE` is `.pi/pi-tools.json` (line 122)
- `findProjectConfigPath()` walks up directories looking for `.pi/pi-tools.json` (line 129)
- `loadConfig()` reads and parses the global config file (line 68)
- `loadMergedConfig()` merges project + global + defaults (line 152)

Usage tracking lives in `src/providers/usage.ts`:
- `getUsagePath()` returns `~/.pi/agent/pi-tools-usage.json` (line 10)

### Other hardcoded references

- `src/tools/code-search.ts` line 54: error message mentions `~/.pi/agent/extensions/pi-tools.json`

### Out of scope

These `pi-tools` references are **not** config filenames and should NOT be changed:
- `src/index.ts` line 162: `"pi-tools-content"` (custom extension type identifier)
- `src/storage.ts` line 38: `"pi-tools-content"` (same identifier)
- `src/extract/github.ts` line 171: `"pi-tools"` (User-Agent header)
- `src/extract/github.ts` line 407: `"pi-tools-github-cache"` (temp cache dir)

---

### Task 1: Extract config-parsing helper, rename global config, add fallback

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

**Why extract a helper?** The plan needs fallback logic (try new path, catch, try old path). Without a helper, the parsing logic (strategy validation, field merging, guidance handling) gets copy-pasted into the catch block. Extract `parseConfigFile(raw: string): PiToolsConfig` to keep it DRY.

- [ ] **Step 1: Write failing test for new config path**

Add to `tests/config.test.ts` inside the `describe("loadConfig")` block:

```ts
it("reads from tools.json path", () => {
  vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
    if (typeof filePath === "string" && filePath.endsWith("tools.json")) {
      return JSON.stringify({ defaultProvider: "brave" });
    }
    throw new Error("ENOENT");
  });
  const config = loadConfig();
  expect(config.defaultProvider).toBe("brave");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/config.test.ts`
Expected: FAIL — the code still looks for `pi-tools.json`

- [ ] **Step 3: Extract parseConfigFile helper and update getConfigPath**

In `src/config.ts`:

1. Add a helper that takes raw JSON and returns `PiToolsConfig`:

```ts
function parseConfigFile(raw: string): PiToolsConfig {
  const parsed = JSON.parse(raw);

  const strategy =
    parsed.selectionStrategy === "auto" || parsed.selectionStrategy === "best-performing"
      ? (parsed.selectionStrategy as SelectionStrategy)
      : DEFAULT_CONFIG.selectionStrategy;

  return {
    defaultProvider: parsed.defaultProvider ?? DEFAULT_CONFIG.defaultProvider,
    selectionStrategy: strategy,
    providers: {
      ...DEFAULT_CONFIG.providers,
      ...parsed.providers,
    },
    github: {
      ...DEFAULT_CONFIG.github,
      ...parsed.github,
    },
    guidance: parsed.guidance,
  };
}
```

2. Add legacy path helper:

```ts
function getLegacyConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "extensions", "pi-tools.json");
}
```

3. Update `getConfigPath()` to return the new filename:

```ts
export function getConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "extensions", "tools.json");
}
```

4. Rewrite `loadConfig()` using the helper:

```ts
export function loadConfig(configPath?: string): PiToolsConfig {
  const filePath = configPath ?? getConfigPath();
  try {
    return parseConfigFile(fs.readFileSync(filePath, "utf-8"));
  } catch {
    // Fallback: try legacy filename (only when using default path)
    if (!configPath) {
      try {
        return parseConfigFile(fs.readFileSync(getLegacyConfigPath(), "utf-8"));
      } catch {
        // Neither file exists
      }
    }
    return { ...DEFAULT_CONFIG };
  }
}
```

- [ ] **Step 4: Write failing test for backward-compat fallback**

Add to `tests/config.test.ts` in the `describe("loadConfig")` block:

```ts
it("falls back to pi-tools.json if tools.json is missing", () => {
  vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
    if (typeof filePath === "string" && filePath.endsWith("pi-tools.json")) {
      return JSON.stringify({ defaultProvider: "exa" });
    }
    throw new Error("ENOENT");
  });
  const config = loadConfig();
  expect(config.defaultProvider).toBe("exa");
});
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `pnpm vitest run tests/config.test.ts`
Expected: PASS (both new tests and all existing tests)

- [ ] **Step 6: Update doc comments**

Update the JSDoc comments on `findProjectConfigPath` (line 124-127) and `loadMergedConfig` (line 143-150) to reference `tools.json` instead of `pi-tools.json`.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "refactor: rename global config to tools.json with fallback"
```

---

### Task 2: Update project config path with fallback

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write failing test for new project config path**

Add to `tests/config.test.ts` inside the `describe("findProjectConfigPath")` block:

```ts
it("finds .pi/tools.json in directory", () => {
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    return typeof p === "string" && p === path.join("/projects/my-app", ".pi", "tools.json");
  });
  const result = findProjectConfigPath("/projects/my-app");
  expect(result).toBe(path.join("/projects/my-app", ".pi", "tools.json"));
});

it("prefers tools.json over pi-tools.json when both exist", () => {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  const result = findProjectConfigPath("/projects/my-app");
  expect(result).toBe(path.join("/projects/my-app", ".pi", "tools.json"));
});

it("falls back to .pi/pi-tools.json if tools.json missing", () => {
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    return typeof p === "string" && p.includes(path.join(".pi", "pi-tools.json"));
  });
  const result = findProjectConfigPath("/projects/my-app");
  expect(result).toContain(path.join(".pi", "pi-tools.json"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/config.test.ts`
Expected: FAIL — first two tests fail because the code only checks `pi-tools.json`

- [ ] **Step 3: Update findProjectConfigPath**

In `src/config.ts`:

```ts
const PROJECT_CONFIG_RELATIVE = path.join(".pi", "tools.json");
const LEGACY_PROJECT_CONFIG_RELATIVE = path.join(".pi", "pi-tools.json");

export function findProjectConfigPath(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const candidate = path.join(dir, PROJECT_CONFIG_RELATIVE);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    // Fallback: check legacy name at same level
    const legacy = path.join(dir, LEGACY_PROJECT_CONFIG_RELATIVE);
    if (fs.existsSync(legacy)) {
      return legacy;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
```

- [ ] **Step 4: Update existing findProjectConfigPath tests**

The existing tests check legacy paths. They should still pass since the fallback supports old names, but the `existsSync` call count in the "stops after 10 levels" test may change (now 2 calls per level instead of 1). Update:

```ts
it("stops after 10 levels", () => {
  const calls: string[] = [];
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    calls.push(p as string);
    return false;
  });
  findProjectConfigPath("/a/b/c/d/e/f/g/h/i/j/k/l/m/n");
  // 2 checks per level (new name + legacy), 10 levels max
  expect(calls.length).toBeLessThanOrEqual(20);
});

it("stops at filesystem root", () => {
  const calls: string[] = [];
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    calls.push(p as string);
    return false;
  });
  findProjectConfigPath("/a/b");
  // /a/b, /a, / — 2 checks each = 6
  expect(calls.length).toBe(6);
});
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `pnpm vitest run tests/config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "refactor: rename project config to .pi/tools.json with fallback"
```

---

### Task 3: Add global fallback to loadMergedConfig

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

**Why this task?** `loadMergedConfig` reads the global config with `fs.readFileSync(getConfigPath())`. Since `getConfigPath()` now returns the new `tools.json` path, users who still have only `pi-tools.json` would silently lose their global config during merging. The fallback must happen here too.

- [ ] **Step 1: Write failing test**

Add to `tests/config.test.ts` inside the `describe("loadMergedConfig")` block:

```ts
it("falls back to legacy global config path when tools.json is missing", () => {
  vi.mocked(fs.readFileSync).mockImplementation((p) => {
    const filePath = typeof p === "string" ? p : p.toString();
    if (filePath.includes("pi-tools.json") && filePath.includes(path.join(".pi", "agent"))) {
      return JSON.stringify({ defaultProvider: "tavily" });
    }
    throw new Error("ENOENT");
  });
  vi.mocked(fs.existsSync).mockReturnValue(false);

  const config = loadMergedConfig("/projects/my-app");
  expect(config.defaultProvider).toBe("tavily");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/config.test.ts`
Expected: FAIL — `loadMergedConfig` catches the ENOENT on `tools.json` and skips to defaults

- [ ] **Step 3: Add fallback in loadMergedConfig**

In `src/config.ts`, update the global config layer in `loadMergedConfig`:

```ts
// Layer 2: global config
const globalPath = getConfigPath();
try {
  const raw = fs.readFileSync(globalPath, "utf-8");
  merged = deepMerge(merged, JSON.parse(raw) as Record<string, unknown>);
} catch {
  // Fallback: try legacy global path
  try {
    const raw = fs.readFileSync(getLegacyConfigPath(), "utf-8");
    merged = deepMerge(merged, JSON.parse(raw) as Record<string, unknown>);
  } catch {
    // No global config — defaults stand
  }
}
```

- [ ] **Step 4: Update loadMergedConfig test mocks that reference pi-tools.json**

The existing `loadMergedConfig` tests use `filePath.includes(path.join(".pi", "pi-tools.json"))` to match project config reads and `filePath.includes(path.join(".pi", "agent"))` to match global config reads. Since `tools.json` also lives under `.pi/agent/extensions/`, the global path discriminator still works. But verify each test: the project config mocks that match on `pi-tools.json` should keep working because `findProjectConfigPath` falls back to the legacy name.

Run: `pnpm vitest run tests/config.test.ts`
Expected: PASS — all existing and new tests

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "refactor: add legacy fallback to loadMergedConfig global layer"
```

---

### Task 4: Rename usage file with fallback

**Files:**
- Modify: `src/providers/usage.ts`

- [ ] **Step 1: Update getUsagePath and add fallback**

In `src/providers/usage.ts`:

```ts
function getUsagePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "tools-usage.json");
}

function getLegacyUsagePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "pi-tools-usage.json");
}
```

Update `load()`:

```ts
private load(): void {
  try {
    const raw = fs.readFileSync(getUsagePath(), "utf-8");
    const data: UsageData = JSON.parse(raw);
    if (data.resetAt === this.resetAt) {
      this.counts = data.counts ?? {};
    }
  } catch {
    // Try legacy path
    try {
      const raw = fs.readFileSync(getLegacyUsagePath(), "utf-8");
      const data: UsageData = JSON.parse(raw);
      if (data.resetAt === this.resetAt) {
        this.counts = data.counts ?? {};
      }
    } catch {
      // No file or parse error — start fresh
    }
  }
}
```

`save()` already calls `getUsagePath()` — new writes go to `tools-usage.json` automatically.

- [ ] **Step 2: Run full test suite**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/providers/usage.ts
git commit -m "refactor: rename usage file to tools-usage.json with fallback"
```

---

### Task 5: Update hardcoded path in code-search.ts error message

**Files:**
- Modify: `src/tools/code-search.ts`

- [ ] **Step 1: Update the error message**

In `src/tools/code-search.ts` line 54, change:

```ts
// Old:
text: "code_search requires an Exa API key. Set the EXA_API_KEY environment variable or configure it in ~/.pi/agent/extensions/pi-tools.json.",
// New:
text: "code_search requires an Exa API key. Set the EXA_API_KEY environment variable or configure it in ~/.pi/agent/extensions/tools.json.",
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/tools/code-search.ts
git commit -m "fix: update config path in code-search error message"
```

---

### Task 6: Update README and run full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README references**

In `README.md` line 33, change:

```
Create `~/.pi/agent/extensions/pi-tools.json`:
```

to:

```
Create `~/.pi/agent/extensions/tools.json`:
```

Keep any references to the package name `@pi-vault/pi-tools` unchanged (that's the npm package name, not a filename).

- [ ] **Step 2: Run full verification**

Run: `pnpm check`
Expected: lint PASS, typecheck PASS, tests PASS

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update config file references in README"
```
