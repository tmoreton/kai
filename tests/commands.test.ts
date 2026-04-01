import { describe, it, expect } from "vitest";
import { resolveCommand, type CustomCommand } from "../src/commands.js";

describe("commands", () => {
  describe("resolveCommand", () => {
    it("replaces {{args}} placeholder", () => {
      const cmd: CustomCommand = {
        name: "test",
        description: "Test command",
        prompt: "Run tests for {{args}}",
        source: "project",
        filePath: "/test.md",
      };
      const result = resolveCommand(cmd, "src/utils.ts");
      expect(result).toBe("Run tests for src/utils.ts");
    });

    it("replaces {{cwd}} placeholder", () => {
      const cmd: CustomCommand = {
        name: "test",
        description: "Test",
        prompt: "Working in {{cwd}}",
        source: "project",
        filePath: "/test.md",
      };
      const result = resolveCommand(cmd, "");
      expect(result).toContain(process.cwd());
    });

    it("replaces {{date}} placeholder", () => {
      const cmd: CustomCommand = {
        name: "test",
        description: "Test",
        prompt: "Today is {{date}}",
        source: "project",
        filePath: "/test.md",
      };
      const result = resolveCommand(cmd, "");
      expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("handles empty args", () => {
      const cmd: CustomCommand = {
        name: "test",
        description: "Test",
        prompt: "Review {{args}} code",
        source: "project",
        filePath: "/test.md",
      };
      const result = resolveCommand(cmd, "");
      expect(result).toBe("Review  code");
    });
  });
});
