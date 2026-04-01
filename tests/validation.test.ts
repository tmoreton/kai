import { describe, it, expect } from "vitest";
import { validateToolArgs } from "../src/tools/validation.js";

describe("validateToolArgs", () => {
  describe("bash", () => {
    it("accepts valid args", () => {
      const result = validateToolArgs("bash", { command: "ls -la" });
      expect(result.valid).toBe(true);
    });

    it("rejects missing command", () => {
      const result = validateToolArgs("bash", {});
      expect(result.valid).toBe(false);
    });

    it("rejects empty command", () => {
      const result = validateToolArgs("bash", { command: "" });
      expect(result.valid).toBe(false);
    });

    it("accepts optional timeout", () => {
      const result = validateToolArgs("bash", { command: "sleep 1", timeout: 5000 });
      expect(result.valid).toBe(true);
    });

    it("rejects timeout over max", () => {
      const result = validateToolArgs("bash", { command: "ls", timeout: 999999 });
      expect(result.valid).toBe(false);
    });
  });

  describe("read_file", () => {
    it("accepts valid args", () => {
      const result = validateToolArgs("read_file", { file_path: "/tmp/test.txt" });
      expect(result.valid).toBe(true);
    });

    it("rejects missing file_path", () => {
      const result = validateToolArgs("read_file", {});
      expect(result.valid).toBe(false);
    });

    it("accepts offset and limit", () => {
      const result = validateToolArgs("read_file", { file_path: "/tmp/test.txt", offset: 10, limit: 50 });
      expect(result.valid).toBe(true);
    });
  });

  describe("write_file", () => {
    it("accepts valid args", () => {
      const result = validateToolArgs("write_file", { file_path: "/tmp/out.txt", content: "hello" });
      expect(result.valid).toBe(true);
    });

    it("rejects missing content", () => {
      const result = validateToolArgs("write_file", { file_path: "/tmp/out.txt" });
      expect(result.valid).toBe(false);
    });
  });

  describe("edit_file", () => {
    it("accepts valid args", () => {
      const result = validateToolArgs("edit_file", {
        file_path: "foo.ts",
        old_string: "const a = 1",
        new_string: "const a = 2",
      });
      expect(result.valid).toBe(true);
    });

    it("accepts replace_all flag", () => {
      const result = validateToolArgs("edit_file", {
        file_path: "foo.ts",
        old_string: "a",
        new_string: "b",
        replace_all: true,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("glob", () => {
    it("accepts valid pattern", () => {
      const result = validateToolArgs("glob", { pattern: "**/*.ts" });
      expect(result.valid).toBe(true);
    });

    it("rejects empty pattern", () => {
      const result = validateToolArgs("glob", { pattern: "" });
      expect(result.valid).toBe(false);
    });
  });

  describe("grep", () => {
    it("accepts valid pattern", () => {
      const result = validateToolArgs("grep", { pattern: "function\\s+\\w+" });
      expect(result.valid).toBe(true);
    });

    it("accepts all optional args", () => {
      const result = validateToolArgs("grep", {
        pattern: "TODO",
        path: "/src",
        include: "*.ts",
        context: 3,
        ignore_case: true,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("web_fetch", () => {
    it("accepts valid URL", () => {
      const result = validateToolArgs("web_fetch", { url: "https://example.com" });
      expect(result.valid).toBe(true);
    });

    it("rejects invalid URL", () => {
      const result = validateToolArgs("web_fetch", { url: "not-a-url" });
      expect(result.valid).toBe(false);
    });
  });

  describe("web_search", () => {
    it("accepts valid query", () => {
      const result = validateToolArgs("web_search", { query: "how to use vitest" });
      expect(result.valid).toBe(true);
    });

    it("rejects empty query", () => {
      const result = validateToolArgs("web_search", { query: "" });
      expect(result.valid).toBe(false);
    });
  });

  describe("spawn_agent", () => {
    it("accepts valid agent types", () => {
      for (const agent of ["explorer", "planner", "worker"]) {
        const result = validateToolArgs("spawn_agent", { agent, task: "do something" });
        expect(result.valid).toBe(true);
      }
    });

    it("rejects invalid agent type", () => {
      const result = validateToolArgs("spawn_agent", { agent: "hacker", task: "do something" });
      expect(result.valid).toBe(false);
    });
  });

  describe("unknown tools", () => {
    it("passes through unknown tools without validation", () => {
      const result = validateToolArgs("mcp__server__tool", { anything: "goes" });
      expect(result.valid).toBe(true);
    });
  });
});
