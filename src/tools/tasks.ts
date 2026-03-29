import fs from "fs";
import path from "path";
import chalk from "chalk";
import { ensureKaiDir } from "../config.js";

export interface Task {
  id: number;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  createdAt: string;
}

let tasks: Task[] = [];
let nextId = 1;

function tasksFilePath(): string {
  return path.join(ensureKaiDir(), "tasks.json");
}

function loadTasksFromDisk(): void {
  try {
    const filePath = tasksFilePath();
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (Array.isArray(data.tasks)) {
        tasks = data.tasks;
        nextId = data.nextId || (tasks.length > 0 ? Math.max(...tasks.map((t) => t.id)) + 1 : 1);
      }
    }
  } catch {
    // Start fresh if file is corrupt
  }
}

function saveTasksToDisk(): void {
  try {
    fs.writeFileSync(
      tasksFilePath(),
      JSON.stringify({ tasks, nextId }, null, 2),
      "utf-8"
    );
  } catch {
    // Silently fail — tasks are still in memory
  }
}

// Load on module init
loadTasksFromDisk();

export function createTask(args: {
  subject: string;
  description: string;
}): string {
  const task: Task = {
    id: nextId++,
    subject: args.subject,
    description: args.description,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  saveTasksToDisk();
  return `Task #${task.id} created: ${task.subject}`;
}

export function updateTask(args: {
  task_id: number;
  status?: "pending" | "in_progress" | "completed";
  subject?: string;
  description?: string;
}): string {
  const task = tasks.find((t) => t.id === args.task_id);
  if (!task) return `Task #${args.task_id} not found.`;

  if (args.status) task.status = args.status;
  if (args.subject) task.subject = args.subject;
  if (args.description) task.description = args.description;

  saveTasksToDisk();
  return `Task #${task.id} updated: [${task.status}] ${task.subject}`;
}

export function listTasks(): string {
  if (tasks.length === 0) return "No tasks.";

  const icons = {
    pending: "○",
    in_progress: "◐",
    completed: "●",
  };

  return tasks
    .map(
      (t) =>
        `${icons[t.status]} #${t.id} [${t.status}] ${t.subject}${t.description ? ` — ${t.description}` : ""}`
    )
    .join("\n");
}

export function getTasksForDisplay(): string {
  if (tasks.length === 0) return "";

  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;

  let display = chalk.dim(`  Tasks: ${completed}/${total} done`);
  if (inProgress > 0) display += chalk.yellow(` (${inProgress} in progress)`);

  return display;
}
