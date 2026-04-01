import { describe, it, expect, beforeEach } from "vitest";
import { setPermissionMode, getPermissionMode, getPermissionRules } from "../src/permissions.js";

describe("permissions", () => {
  beforeEach(() => {
    setPermissionMode("auto");
  });

  it("returns the current permission mode", () => {
    expect(getPermissionMode()).toBe("auto");
  });

  it("can change permission mode", () => {
    setPermissionMode("default");
    expect(getPermissionMode()).toBe("default");
  });

  it("has default rules", () => {
    const rules = getPermissionRules();
    expect(rules.length).toBeGreaterThan(0);

    // Read-only tools should be allowed
    const readFileRule = rules.find((r) => r.tool === "read_file");
    expect(readFileRule?.action).toBe("allow");

    // Destructive commands should be denied
    const rmRfRoot = rules.find((r) => r.tool === "bash" && r.pattern === "rm -rf /");
    expect(rmRfRoot?.action).toBe("deny");
  });

  it("has write operations as ask", () => {
    const rules = getPermissionRules();
    const writeRule = rules.find((r) => r.tool === "write_file" && !r.pattern);
    expect(writeRule?.action).toBe("ask");
  });
});
