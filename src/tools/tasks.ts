import chalk from "chalk";

export interface Task {
  id: number;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  createdAt: string;
  owner: string; // "system", "youtube", "user", or specific agent ID
}

// Tasks are session-scoped — they reset on each new session
let tasks: Task[] = [];
let nextId = 1;

export function createTask(args: {
  subject: string;
  description: string;
  owner?: string; // defaults to "system"
}): string {
  const task: Task = {
    id: nextId++,
    subject: args.subject,
    description: args.description,
    status: "pending",
    createdAt: new Date().toISOString(),
    owner: args.owner || "system",
  };
  tasks.push(task);
  return `Task #${task.id} created: ${task.subject} [${task.owner}]`;
}

export function updateTask(args: {
  task_id: number;
  status?: "pending" | "in_progress" | "completed";
  subject?: string;
  description?: string;
  owner?: string;
}): string {
  const task = tasks.find((t) => t.id === args.task_id);
  if (!task) return `Task #${args.task_id} not found.`;

  if (args.status) task.status = args.status;
  if (args.subject) task.subject = args.subject;
  if (args.description) task.description = args.description;
  if (args.owner) task.owner = args.owner;

  return `Task #${task.id} updated: [${task.status}] ${task.subject} [${task.owner}]`;
}

export function listTasks(owner?: string): string {
  const filteredTasks = owner ? tasks.filter(t => t.owner === owner) : tasks;
  
  if (filteredTasks.length === 0) return owner ? `No tasks for ${owner}.` : "No tasks.";

  const icons = {
    pending: "◻",
    in_progress: "✢",
    completed: "✔",
  };

  return filteredTasks
    .map(
      (t) =>
        `${icons[t.status]} [${t.owner}] ${t.subject}${t.description ? ` — ${t.description}` : ""}`
    )
    .join("\n");
}

export function listTasksByOwner(): Record<string, Task[]> {
  const grouped: Record<string, Task[]> = {};
  for (const t of tasks) {
    if (!grouped[t.owner]) grouped[t.owner] = [];
    grouped[t.owner].push(t);
  }
  return grouped;
}

export function getTasksForDisplay(owner?: string): string {
  const filteredTasks = owner ? tasks.filter(t => t.owner === owner) : tasks;
  
  if (filteredTasks.length === 0) return "";

  const taskLines: string[] = [];
  for (const t of filteredTasks) {
    const icon = t.status === "completed" ? chalk.green("✔") : t.status === "in_progress" ? chalk.cyan("✢") : chalk.dim("◻");
    const text = t.status === "completed" ? chalk.dim(t.subject) : t.subject;
    const ownerLabel = chalk.gray(`[${t.owner}]`);
    taskLines.push(`  ${icon} ${ownerLabel} ${text}`);
  }
  return taskLines.join("\n");
}

export function getAllTasks(): Task[] {
  return [...tasks];
}
