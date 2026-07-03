# Phase 7: Config Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the config file from `pi-tools.json` to `tools.json` with backward compatibility for existing users.

**Architecture:** Update the filename constant in `config.ts`, add a fallback that reads the old name if the new name doesn't exist, and update all references across the codebase.

**Tech Stack:** TypeScript 6, Vitest 4, Node 24+ fs APIs

---

## Context

The config system lives in `src/config.ts`. Key constants:
- `getConfigPath()` returns `~/.pi/agent/extensions/pi-tools.json`
- `PROJECT_CONFIG_RELATIVE` is `.pi/pi-tools.json`
- `findProjectConfigPath()` walks up directories looking for `.pi/pi-tools.json`
- `loadMergedConfig()` merges project + global + defaults
- Usage tracking file is at `~/.pi/agent/pi-tools-usage.json` (in `src/providers/usage.ts`)

Tests mock `node:fs` and test against these paths.

---

### Task 1: Update global config path with backward compat

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

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
Expected: FAIL — the test reads from the new path but the code still looks for `pi-tools.json`

- [ ] **Step 3: Update getConfigPath to use new filename**

In `src/config.ts`, change line 65:

```ts
export function getConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "extensions", "tools.json");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for backward compat fallback**

Add to `tests/config.test.ts`:

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

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run tests/config.test.ts`
Expected: FAIL — code only reads `tools.json`, doesn't fall back

- [ ] **Step 7: Add fallback logic to loadConfig**

In `src/config.ts`, update `loadConfig`:

```ts
function getLegacyConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "extensions", "pi-tools.json");
}

export function loadConfig(configPath?: string): PiToolsConfig {
  const filePath = configPath ?? getConfigPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    const strategy = (parsed.selectionStrategy === "auto" || parsed.selectionStrategy === "best-performing")
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
  } catch {
    // Fallback: try legacy filename
    if (!configPath) {
      try {
        const raw = fs.readFileSync(getLegacyConfigPath(), "utf-8");
        const parsed = JSON.parse(raw);

        const strategy = (parsed.selectionStrategy === "auto" || parsed.selectionStrategy === "best-performing")
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
      } catch {
        // Neither file exists
      }
    }
    return { ...DEFAULT_CONFIG };
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run tests/config.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "refactor: rename global config to tools.json with fallback"
```

---

### Task 2: Update project config path

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write failing test for new project config path**

Add to `tests/config.test.ts` inside the `describe("findProjectConfigPath")` block:

```ts
it("finds .pi/tools.json in directory", () => {
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    return typeof p === "string" && p.includes(path.join(".pi", "tools.json"));
  });
  const result = findProjectConfigPath("/home/user/project");
  expect(result).toContain(path.join(".pi", "tools.json"));
});

it("falls back to .pi/pi-tools.json if tools.json missing", () => {
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    return typeof p === "string" && p.includes(path.join(".pi", "pi-tools.json"));
  });
  const result = findProjectConfigPath("/home/user/project");
  expect(result).toContain(path.join(".pi", "pi-tools.json"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/config.test.ts`
Expected: FAIL — code only looks for `pi-tools.json`

- [ ] **Step 3: Update findProjectConfigPath to look for both filenames**

In `src/config.ts`, update the constant and function:

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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "refactor: rename project config to .pi/tools.json with fallback"
```

---

### Task 3: Update commands/tools.ts and usage.ts paths

**Files:**
- Modify: `src/commands/tools.ts`
- Modify: `src/providers/usage.ts`
- Test: `tests/commands/tools.test.ts`

- [ ] **Step 1: Update tools command config path reference**

In `src/commands/tools.ts`, find where `getConfigPath()` is called (it's imported from config.ts). The path is already correct since we updated `getConfigPath()`. Check if there are any hardcoded `"pi-tools.json"` strings:

```bash
grep -n "pi-tools" src/commands/tools.ts
```

If any hardcoded references exist, update them to `"tools.json"`.

- [ ] **Step 2: Update usage tracking file path**

In `src/providers/usage.ts`, update line 11:

```ts
function getUsagePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "tools-usage.json");
}
```

Note: This is a rename from `pi-tools-usage.json` to `tools-usage.json`. Add fallback for existing data:

```ts
function getLegacyUsagePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "pi-tools-usage.json");
}
```

Update the `load()` method in the `UsageTracker` class:

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

- [ ] **Step 3: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/commands/tools.ts src/providers/usage.ts
git commit -m "refactor: rename usage file to tools-usage.json with fallback"
```

---

### Task 4: Update README and run full check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README references**

Search and replace in `README.md`:
- `pi-tools.json` → `tools.json`
- `pi-tools-usage.json` → `tools-usage.json`

Keep any references to the package name `@pi-vault/pi-tools` unchanged (that's the npm package name, not a filename).

- [ ] **Step 2: Run full verification**

Run: `pnpm check`
Expected: lint PASS, typecheck PASS, tests PASS

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update config file references in README"
```
