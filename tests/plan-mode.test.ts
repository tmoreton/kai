import { describe, it, expect, beforeEach } from "vitest";
import {
  isPlanMode,
  setPlanMode,
  togglePlanMode,
  isToolAllowedInPlanMode,
} from "../src/plan-mode.js";

describe("plan-mode", () => {
  beforeEach(() => {
    setPlanMode(false);
  });

  it("defaults to off", () => {
    expect(isPlanMode()).toBe(false);
  });

  it("can be toggled on and off", () => {
    expect(togglePlanMode()).toBe(true);
    expect(isPlanMode()).toBe(true);
    expect(togglePlanMode()).toBe(false);
    expect(isPlanMode()).toBe(false);
  });

  it("can be set directly", () => {
    setPlanMode(true);
    expect(isPlanMode()).toBe(true);
    setPlanMode(false);
    expect(isPlanMode()).toBe(false);
  });

  describe("isToolAllowedInPlanMode", () => {
    it("allows all tools when plan mode is off", () => {
      setPlanMode(false);
      expect(isToolAllowedInPlanMode("bash")).toBe(true);
      expect(isToolAllowedInPlanMode("write_file")).toBe(true);
      expect(isToolAllowedInPlanMode("edit_file")).toBe(true);
    });

    it("allows read-only tools in plan mode", () => {
      setPlanMode(true);
      expect(isToolAllowedInPlanMode("read_file")).toBe(true);
      expect(isToolAllowedInPlanMode("glob")).toBe(true);
      expect(isToolAllowedInPlanMode("grep")).toBe(true);
      expect(isToolAllowedInPlanMode("web_fetch")).toBe(true);
      expect(isToolAllowedInPlanMode("web_search")).toBe(true);
      expect(isToolAllowedInPlanMode("core_memory_read")).toBe(true);
      expect(isToolAllowedInPlanMode("recall_search")).toBe(true);
      expect(isToolAllowedInPlanMode("archival_search")).toBe(true);
    });

    it("blocks write tools in plan mode", () => {
      setPlanMode(true);
      expect(isToolAllowedInPlanMode("bash")).toBe(false);
      expect(isToolAllowedInPlanMode("bash_background")).toBe(false);
      expect(isToolAllowedInPlanMode("write_file")).toBe(false);
      expect(isToolAllowedInPlanMode("edit_file")).toBe(false);
      expect(isToolAllowedInPlanMode("generate_image")).toBe(false);
    });
  });
});
