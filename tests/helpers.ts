import * as fs from "node:fs";
import type { ExecFileFn } from "../src/providers/duckduckgo.ts";
import { vi } from "vitest";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

// Simplified mock interface — avoids inheriting ExtensionAPI's 30+ overloaded
// `on()` signatures which cannot be satisfied by a generic implementation.
type EventHandler = (...args: unknown[]) => unknown;

export interface MockPi {
  tools: ToolDefinition[];
  commands: Array<{
    name: string;
    options: { description?: string; handler: (...args: unknown[]) => unknown };
  }>;
  events: Map<string, EventHandler[]>;
  entries: Array<{ customType: string; data: unknown }>;
  registerTool(tool: ToolDefinition): void;
  registerCommand(
    name: string,
    options: { description?: string; handler: (...args: unknown[]) => unknown },
  ): void;
  on(event: string, handler: EventHandler): void;
  appendEntry(customType: string, data?: unknown): void;
}

export function createMockPi(): MockPi {
  const tools: ToolDefinition[] = [];
  const commands: Array<{
    name: string;
    options: { description?: string; handler: (...args: unknown[]) => unknown };
  }> = [];
  const events = new Map<string, EventHandler[]>();
  const entries: Array<{ customType: string; data: unknown }> = [];

  return {
    tools,
    commands,
    events,
    entries,
    registerTool(tool: ToolDefinition) {
      tools.push(tool);
    },
    registerCommand(
      name: string,
      options: { description?: string; handler: (...args: unknown[]) => unknown },
    ) {
      commands.push({ name, options });
    },
    on(event: string, handler: EventHandler) {
      if (!events.has(event)) events.set(event, []);
      events.get(event)?.push(handler);
    },
    appendEntry(customType: string, data?: unknown) {
      entries.push({ customType, data });
    },
  };
}

export function makeCtx(overrides?: Partial<ExtensionContext>): ExtensionContext {
  return {
    ui: {
      notify: vi.fn(),
      select: vi.fn(),
      confirm: vi.fn(),
      input: vi.fn(),
      setStatus: vi.fn(),
    },
    mode: "tui",
    hasUI: true,
    cwd: "/tmp/test",
    sessionManager: {
      getEntries: vi.fn().mockReturnValue([]),
    },
    model: undefined,
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort: vi.fn(),
    hasPendingMessages: () => false,
    shutdown: vi.fn(),
    getContextUsage: () => undefined,
    compact: vi.fn(),
    getSystemPrompt: () => "",
    ...overrides,
  } as unknown as ExtensionContext;
}

export interface FetchStub {
  addResponse(
    urlPattern: string | RegExp,
    response: {
      status?: number;
      body?: string | object;
      headers?: Record<string, string>;
    },
  ): void;
  restore(): void;
}

export function stubFetch(): FetchStub {
  const routes: Array<{
    pattern: string | RegExp;
    response: { status: number; body: string; headers: Record<string, string> };
  }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = vi.fn(async (input: string | URL, _init?: object) => {
    const url = input instanceof URL ? input.href : input;
    for (const route of routes) {
      const matches =
        typeof route.pattern === "string" ? url.includes(route.pattern) : route.pattern.test(url);
      if (matches) {
        return new Response(route.response.body, {
          status: route.response.status,
          headers: route.response.headers,
        });
      }
    }
    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;

  return {
    addResponse(urlPattern, response) {
      routes.push({
        pattern: urlPattern,
        response: {
          status: response.status ?? 200,
          body:
            typeof response.body === "object"
              ? JSON.stringify(response.body)
              : (response.body ?? ""),
          headers: response.headers ?? { "content-type": "application/json" },
        },
      });
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

export interface ExecStub {
  /** The mock execFile function to pass to DuckDuckGoProvider's constructor. */
  fn: ExecFileFn;
  /** Set the JSON data that ddgs will "return" via the output file. */
  setOutput(data: unknown): void;
  /** Set a non-zero exit code to simulate CLI failure. */
  setError(error: { code?: number; message?: string }): void;
  /** Make ddgs appear unavailable (command not found). */
  setUnavailable(): void;
  /** No-op, kept for API symmetry with stubFetch. */
  restore(): void;
  /** The args from the most recent execFile call. */
  lastArgs(): string[] | undefined;
}

export function stubExec(): ExecStub {
  let outputData: unknown = [];
  let errorConfig: { code?: number; message?: string } | null = null;
  let unavailable = false;
  let capturedArgs: string[] | undefined;

  // Mock execFile function — passed to DuckDuckGoProvider via constructor injection.
  // This avoids monkey-patching the non-configurable Node built-in module namespace.
  const mockFn: ExecFileFn = (
    cmd: string,
    args: string[],
    _opts: { timeout?: number },
    callback: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    capturedArgs = args;

    if (unavailable) {
      const err = Object.assign(new Error(`spawn ${cmd} ENOENT`), {
        code: "ENOENT",
      });
      callback(err, "", "");
      return { kill: vi.fn() };
    }

    if (errorConfig) {
      const err = Object.assign(new Error(errorConfig.message ?? "ddgs failed"), {
        code: errorConfig.code ?? 1,
      });
      callback(err, "", errorConfig.message ?? "");
      return { kill: vi.fn() };
    }

    // Write fixture JSON to the output file path extracted from args (-o <path>)
    const oIdx = args.indexOf("-o");
    if (oIdx !== -1 && oIdx + 1 < args.length) {
      fs.writeFileSync(args[oIdx + 1], JSON.stringify(outputData));
    }

    callback(null, "", "");
    return { kill: vi.fn() };
  };

  return {
    fn: mockFn,
    setOutput(data: unknown) {
      outputData = data;
      errorConfig = null;
      unavailable = false;
    },
    setError(error) {
      errorConfig = error;
      unavailable = false;
    },
    setUnavailable() {
      unavailable = true;
      errorConfig = null;
    },
    restore() {
      // no-op: dependency injection, nothing to restore
    },
    lastArgs() {
      return capturedArgs;
    },
  };
}
