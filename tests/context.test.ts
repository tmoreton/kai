import { describe, it, expect, beforeEach } from "vitest";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// We need to test the pure functions from context.ts
// Import after mocking if needed
import {
  estimateContextSize,
  compactMessages,
  formatCost,
  formatContextBreakdown,
  trackUsage,
  checkBudget,
} from "../src/context.js";

describe("context", () => {
  describe("estimateContextSize", () => {
    it("estimates tokens for simple messages", () => {
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ];
      const size = estimateContextSize(messages);
      // Should include ~5000 for tool definitions + message content
      expect(size).toBeGreaterThan(5000);
      expect(size).toBeLessThan(6000);
    });

    it("handles empty messages", () => {
      const size = estimateContextSize([]);
      expect(size).toBe(5000); // Just tool definitions
    });
  });

  describe("compactMessages", () => {
    it("returns small conversations unchanged", () => {
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: "system" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ];
      const result = compactMessages(messages);
      expect(result).toEqual(messages);
    });

    it("compacts long conversations", () => {
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: "system prompt" },
      ];
      // Add many messages
      for (let i = 0; i < 30; i++) {
        messages.push({ role: "user", content: `User message ${i} with some content` });
        messages.push({ role: "assistant", content: `Assistant response ${i}` });
      }
      const result = compactMessages(messages);
      // Should be shorter than original
      expect(result.length).toBeLessThan(messages.length);
      // Should keep system message
      expect(result[0].role).toBe("system");
      // Should have a summary message
      expect(typeof result[1].content === "string" && result[1].content.includes("Compacted")).toBe(true);
    });
  });

  describe("checkBudget", () => {
    it("returns ok when no budget is set", () => {
      const result = checkBudget();
      expect(result.status).toBe("ok");
      expect(result.limit).toBe(0);
    });
  });

  describe("formatCost", () => {
    it("returns formatted string", () => {
      const result = formatCost();
      expect(result).toContain("Token Usage");
      expect(result).toContain("Input");
      expect(result).toContain("Output");
    });
  });
});
