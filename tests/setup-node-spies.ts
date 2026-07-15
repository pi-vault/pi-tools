/**
 * Global Vitest setup: make Node.js built-in modules configurable so that
 * vi.spyOn() can intercept their exports without per-test vi.mock() calls.
 *
 * Spreading the original module into a plain object ({...actual}) turns the
 * immutable ESM namespace into a configurable POJO that vi.spyOn can modify.
 * Tests that have their own vi.mock("node:fs", ...) override this mock entirely.
 */
import { vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual };
});

vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return { ...actual };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual };
});
