import { vi } from "vitest";
import type {
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

// Simplified mock interface — avoids inheriting ExtensionAPI's 30+ overloaded
// `on()` signatures which cannot be satisfied by a generic implementation.
export interface MockPi {
  tools: ToolDefinition[];
  events: Map<string, Function[]>;
  entries: Array<{ customType: string; data: unknown }>;
  registerTool(tool: ToolDefinition): void;
  on(event: string, handler: Function): void;
  appendEntry(customType: string, data?: unknown): void;
}

export function createMockPi(): MockPi {
  const tools: ToolDefinition[] = [];
  const events = new Map<string, Function[]>();
  const entries: Array<{ customType: string; data: unknown }> = [];

  return {
    tools,
    events,
    entries,
    registerTool(tool: ToolDefinition) {
      tools.push(tool);
    },
    on(event: string, handler: Function) {
      if (!events.has(event)) events.set(event, []);
      events.get(event)!.push(handler);
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
        typeof route.pattern === "string"
          ? url.includes(route.pattern)
          : route.pattern.test(url);
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
