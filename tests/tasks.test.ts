import { describe, it, expect } from "vitest";
import { createTask, updateTask, listTasks } from "../src/tools/tasks.js";

describe("tasks", () => {
  it("creates a task", () => {
    const result = createTask({ subject: "Test task", description: "Do the thing" });
    expect(result).toContain("created");
    expect(result).toContain("Test task");
  });

  it("lists tasks", () => {
    const result = listTasks();
    expect(result).toContain("Test task");
  });

  it("updates task status", () => {
    // Create a fresh task to get a known ID
    const createResult = createTask({ subject: "Update me", description: "testing" });
    const idMatch = createResult.match(/#(\d+)/);
    expect(idMatch).not.toBeNull();
    const taskId = parseInt(idMatch![1]);

    const result = updateTask({ task_id: taskId, status: "completed" });
    expect(result).toContain("completed");
  });

  it("handles updating non-existent task", () => {
    const result = updateTask({ task_id: 9999 });
    expect(result).toContain("not found");
  });
});
