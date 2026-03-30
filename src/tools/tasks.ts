import chalk from "chalk";

export interface Task {
  id: number;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  createdAt: string;
}

// Tasks are session-scoped — they reset on each new session
let tasks: Task[] = [];
let nextId = 1;

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

  return `Task #${task.id} updated: [${task.status}] ${task.subject}`;
}

export function listTasks(): string {
  if (tasks.length === 0) return "No tasks.";

  const icons = {
    pending: "◻",
    in_progress: "✢",
    completed: "✔",
  };

  return tasks
    .map(
      (t) =>
        `${icons[t.status]} ${t.subject}${t.description ? ` — ${t.description}` : ""}`
    )
    .join("\n");
}

export function getTasksForDisplay(): string {
  if (tasks.length === 0) return "";

  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;

  const taskLines: string[] = [];
  for (const t of tasks) {
    const icon = t.status === "completed" ? chalk.green("✔") : t.status === "in_progress" ? chalk.cyan("✢") : chalk.dim("◻");
    const text = t.status === "completed" ? chalk.dim(t.subject) : t.subject;
    taskLines.push(`  ${icon} ${text}`);
  }
  return taskLines.join("\n");
}
