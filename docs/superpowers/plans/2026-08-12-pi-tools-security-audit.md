# Pi Tools Security Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the TypeScript Pi extension for exploitable security vulnerabilities and produce independently verified audit artifacts without modifying application source code.

**Architecture:** Run a six-phase source-first audit: reconnaissance, focused hunting, adversarial validation, reporting, schema validation, and independent verification. Treat model/tool inputs, project configuration, arbitrary URL fetching, local-file processing, provider credentials, shell-backed helpers, and persisted content as the primary trust boundaries. Store all audit artifacts under `./security-audit/run-1`.

**Tech Stack:** TypeScript, Node.js 24+, Vitest, Biome, TypeScript compiler, Pi extension APIs, `rg`, Git, and the provided `security-audit` schema validator.

---

### Task 1: Establish the audit workspace and baseline

**Files:**

- Create: `security-audit/run-1/architecture.md`
- Create: `security-audit/run-1/REPORT.md`
- Create: `security-audit/run-1/FINDINGS-DETAIL.md`
- Create: `security-audit/run-1/findings.json`

- [ ] **Step 1: Confirm the target and clean starting state**

Run:

```bash
pwd
git status --short
find security-audit -maxdepth 3 -type f -print 2>/dev/null | sort
```

Expected: repository root is `/Users/lanh/Developer/pi-vault/pi-tools`, no prior `run-1` artifacts, and no application edits are made.

- [ ] **Step 2: Run the existing baseline checks**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test -- --run
pnpm pack --dry-run
```

Record pass/fail output and any pre-existing failures in the audit notes; do not change source to make checks pass.

- [ ] **Step 3: Create the artifact directory**

Run:

```bash
mkdir -p security-audit/run-1
```

Keep all generated audit files in this directory. Do not write findings into `src/` or `tests/`.

- [ ] **Step 4: Commit only the plan if repository policy requires commits**

```bash
git add docs/superpowers/plans/2026-08-12-pi-tools-security-audit.md
git commit -m "docs: add Pi Tools security audit plan"
```

Skip the commit only if the user explicitly wants uncommitted planning artifacts.

### Task 2: Complete reconnaissance and write the architecture summary

**Files:**

- Read: `src/index.ts`, `src/session.ts`, `src/config.ts`, `src/config-manager.ts`
- Read: `src/utils/trust.ts`, `src/utils/ssrf.ts`, `src/storage.ts`, `src/cache.ts`
- Read: `src/tools/*.ts`, `src/extract/*.ts`, `src/providers/*.ts`, `src/research/*.ts`
- Modify: `security-audit/run-1/architecture.md`

- [ ] **Step 1: Inventory entry points and actors**

Document the Pi lifecycle hooks and registered tools/commands. Identify the actors and privileges:

```text
Pi/model -> tool definitions -> providers/extractors
project config -> merged config -> provider registration
URL/file/tool arguments -> network, filesystem, subprocess, or model sinks
session entries -> restored ContentStore state
```

Include exact file and line references for each boundary.

- [ ] **Step 2: Map configuration and trust behavior**

Trace `loadMergedConfig`, `stripSensitiveFields`, `isProjectTrustedCached`, `resolveApiKey`, and provider registration. Record which project-controlled fields remain active when a project is untrusted, especially endpoint URLs, guidance, SSRF ranges, and provider enablement.

- [ ] **Step 3: Map dangerous sinks**

Use:

```bash
rg -n 'fetch\\(|readFile|writeFile|execSync|execFile|spawn|rmSync|clone|queryFile|contextFiles|outputPath|baseUrl|instanceUrl|allowRanges|cookie' src
```

Group results by network, filesystem, subprocess, credentials, model/prompt, and persistence. Note existing mitigations and their limits.

- [ ] **Step 4: Identify the baseline comparable**

Use the application type—local agent/CLI extension—to compare against mainstream local coding-agent tools. Calibrate findings against their accepted trust model: local code execution and user-selected provider credentials may be intentional, but project-controlled configuration must not silently redirect secrets or bypass explicit trust gates.

- [ ] **Step 5: Write `architecture.md`**

Include:

- application type, runtime, packaging, and deployment model;
- trust model and authentication/authorization boundaries;
- complete input and sink inventory;
- comparable baseline and accepted tradeoffs;
- prior-run status: no prior audit artifacts found;
- planned attack classes and explicitly out-of-scope deployment-only checks.

### Task 3: Hunt for network, configuration, and filesystem vulnerabilities

**Files:**

- Read: `src/utils/ssrf.ts`, `src/extract/pipeline.ts`, `src/extract/jina-reader.ts`
- Read: `src/providers/ollama.ts`, `src/providers/searxng.ts`, `src/providers/http-providers.ts`
- Read: `src/research/prepare.ts`, `src/tools/web-research.ts`
- Read: `src/extract/video.ts`, `src/extract/frames.ts`, `src/extract/github.ts`

- [ ] **Step 1: Test SSRF redirects and provider fallback paths**

Build a mocked fetch harness that starts from a permitted public URL and returns redirects to `127.0.0.1`, private IPv4/IPv6, link-local, and DNS-rebinding-style hostnames. Verify whether every hop is validated. Treat Jina, Gemini, provider fallbacks, and Ollama/SearXNG separately because they use different fetchers and trust rules.

- [ ] **Step 2: Test project-controlled endpoint plus inherited credential flows**

Construct an untrusted `.pi/tools.json` with custom `baseUrl`/`instanceUrl` values and enabled providers. Verify whether stripped secrets can nevertheless be sent to attacker-controlled endpoints through global environment credentials or provider fallback resolution. Confirm the exact request headers/body before considering a finding.

- [ ] **Step 3: Test local path and output path boundaries**

Exercise `file://`, absolute, relative, traversal, symlink, and `@`-prefixed paths for:

```text
web_fetch local video input
web_research queryFile/contextFiles/contextGlob
web_research outputPath/rawOutputPath
GitHub clone file paths
```

Use temporary fixtures only. Record whether the caller can read or overwrite files outside the intended project scope and whether Pi trust gates apply.

- [ ] **Step 4: Test resource exhaustion with bounded inputs**

Verify limits for URL count, context files, PDF pages, video size, frame count, response size, redirect count, and research query count. Report only a denial-of-service or denial-of-wallet issue with a concrete shared-resource impact; otherwise record it as hardening.

### Task 4: Hunt for credential, subprocess, model, and data-leakage vulnerabilities

**Files:**

- Read: `src/config.ts`, `src/extract/chrome-cookies.ts`, `src/extract/gemini-web.ts`
- Read: `src/providers/duckduckgo.ts`, `src/extract/pdf-ocr.ts`, `src/extract/frames.ts`
- Read: `src/tools/web-fetch.ts`, `src/tools/web-read.ts`, `src/storage.ts`, `src/cache.ts`
- Read: `src/research/prepare.ts`, `src/research/report.ts`

- [ ] **Step 1: Verify shell and external-command safety**

Trace every `execSync`, `execFile`, `git`, `ddgs`, `ffmpeg`, `ffprobe`, `yt-dlp`, `pdfinfo`, and `pdftoppm` invocation. Confirm attacker-controlled values are passed as argument arrays, not shell strings, and test option injection through URLs, refs, filenames, timestamps, and provider config.

- [ ] **Step 2: Verify browser-cookie and credential boundaries**

Confirm cookie extraction is opt-in, restricted to Google cookie names, and never returned through tool output or logs. Check temporary database cleanup, profile path handling, keychain command arguments, and whether model-controlled URLs can cause those cookies to be sent to another origin.

- [ ] **Step 3: Check model and indirect prompt-injection paths**

Trace fetched web/PDF/YouTube/GitHub content into model prompts and tool results. Report only a code-level boundary crossing: cross-session leakage, privileged capability use, secret exfiltration, or a downstream filesystem/network sink. A model obeying hostile text within the caller’s own session is not sufficient.

- [ ] **Step 4: Check content-store and cache isolation**

Verify cache keys, content IDs, session restoration, and `web_read` lookup behavior. Test whether content from one session or URL can be retrieved through another caller’s identifier, and whether untrusted content is rendered or persisted in a way that affects another user/session.

### Task 5: Hunt business-logic, trust-boundary, and obvious vulnerabilities

**Files:**

- Read: `src/commands/tools.ts`, `src/commands/tools-actions.ts`, `src/commands/tools-dashboard.ts`
- Read: `src/config.ts`, `src/config-manager.ts`, `src/utils/trust.ts`
- Read: all tests matching `tests/*trust*`, `tests/*config*`, `tests/commands/*`, and provider tests

- [ ] **Step 1: Exercise trust-state ordering and lifecycle transitions**

Test `session_start`, `model_select`, and `before_provider_request` in different orders and with changing project trust. Confirm sensitive project values cannot become active before trust is recorded or remain active after trust is removed.

- [ ] **Step 2: Exercise dashboard actions outside the intended UI sequence**

Call `setProviderKey`, `setProviderEnabled`, `setDefaultProvider`, and scoped config writers directly with unknown providers, untrusted projects, shell credentials, literal credentials, malformed documents, and symlinked config paths. Confirm authorization and validation are enforced in the action layer rather than only in the UI.

- [ ] **Step 3: Check fallback and failure-state behavior**

Inspect disabled/missing/malformed provider config, budget exhaustion, provider failure fallback, aborted requests, partial file writes, and session restoration. Look for a safe control becoming permissive when a dependency or config layer fails.

- [ ] **Step 4: Run obvious checks**

Run:

```bash
rg -n --hidden --glob '!pnpm-lock.yaml' --glob '!security-audit/**' \
  'BEGIN (RSA|OPENSSH|EC|PGP)|password|secret|api[_-]?key|Bearer |TODO.*(auth|security)|FIXME.*(auth|security)|eval\\(|new Function|vm\\.' .
git ls-files '*.env' '*.pem' '*.key' '*credentials*'
```

Inspect dependency versions in `package.json` and `pnpm-lock.yaml`; do not turn a version-age concern into a confirmed vulnerability without an applicable exploit.

### Task 6: Consolidate and adversarially validate candidate findings

**Files:**

- Read: all candidate traces from Tasks 3–5
- Modify: `security-audit/run-1/REPORT.md`, `security-audit/run-1/FINDINGS-DETAIL.md`, `security-audit/run-1/findings.json`

- [ ] **Step 1: Deduplicate candidates by root cause**

Merge reports that share the same missing gate or sink. Keep separate findings only when attack prerequisites, impact, or remediation differ materially.

- [ ] **Step 2: Apply the five validation tests to every candidate**

For each candidate, document:

1. exact attacker input and entry point;
2. source-to-sink trace with current line numbers;
3. meaningful attacker impact;
4. mitigation or framework behavior that could stop it;
5. runtime/parser evidence for any URL, path, redirect, shell, or serialization assumption.

Reject theoretical or deployment-dependent claims that cannot be verified from this repository.

- [ ] **Step 3: Write `findings.json` using the provided schema**

Read `/Users/lanh/Developer/dotfiles/configs/skills/security-audit/report-schema.json` and include required fields for every confirmed or rejected finding. Use lowercase severity values and repository-relative trace paths.

- [ ] **Step 4: Validate the JSON structure**

Run:

```bash
node /Users/lanh/Developer/dotfiles/configs/skills/security-audit/validate-findings.cjs \
  security-audit/run-1/findings.json
```

Expected: schema validation succeeds. Fix only the audit artifact if it fails.

### Task 7: Write the final report and independently verify it

**Files:**

- Modify: `security-audit/run-1/REPORT.md`
- Modify: `security-audit/run-1/FINDINGS-DETAIL.md`
- Modify: `security-audit/run-1/findings.json`

- [ ] **Step 1: Write the executive report**

`REPORT.md` must contain an honest executive summary, baseline comparison, findings table, each confirmed finding’s scenario/impact/fix, hardening notes, positive patterns, test evidence, and the no-prior-run coverage limitation.

- [ ] **Step 2: Write detailed traces for MEDIUM+ findings**

For each MEDIUM, HIGH, or CRITICAL finding, include exact file:line flow, payload/action sequence, observable result, prerequisites, and baseline handling. Do not include speculative findings in this section.

- [ ] **Step 3: Independently verify every confirmed finding**

Re-read every cited file and line. Verify the entry point, payload shape, validation path, sink, conditions, impact, and remediation. Change corrected fields in `findings.json`, reject claims that do not survive verification, then synchronize both Markdown reports.

- [ ] **Step 4: Perform final consistency and repository checks**

Run:

```bash
node /Users/lanh/Developer/dotfiles/configs/skills/security-audit/validate-findings.cjs \
  security-audit/run-1/findings.json
pnpm typecheck
pnpm lint
pnpm test -- --run
git diff --check
git status --short
```

Expected: validator, typecheck, lint, tests, and diff check pass; only the plan and `security-audit/run-1/**` artifacts are changed.

## Self-review checklist

- [ ] Every reported vulnerability has a concrete exploit and meaningful impact.
- [ ] Deployment-only assumptions are excluded or explicitly marked unverified.
- [ ] Findings are deduplicated and independently challenged.
- [ ] `findings.json`, `REPORT.md`, and `FINDINGS-DETAIL.md` agree.
- [ ] No source or test files were changed by the audit.
- [ ] No placeholders such as TBD/TODO or vague “add validation” steps remain.
