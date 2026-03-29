import chalk from "chalk";
import { createClient, chat } from "./client.js";
import { getSystemPrompt } from "./system-prompt.js";
import { getCoreMemoryContext } from "./soul.js";
import { getCwd } from "./tools/bash.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * Cron / Scheduler System
 *
 * Allows scheduling recurring prompts that run in the background.
 * Each cron job has:
 *   - A prompt (what to do)
 *   - An interval (how often, in ms)
 *   - Optional: max runs, enabled/disabled
 *
 * Cron jobs run within the current process (not as separate daemons).
 * They share the same tool access as the main REPL.
 */

export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  intervalMs: number;
  enabled: boolean;
  maxRuns?: number;
  runCount: number;
  lastRun?: string;
  nextRun?: string;
  timerId?: ReturnType<typeof setInterval>;
}

const jobs = new Map<string, CronJob>();
let nextJobId = 1;

export function createCronJob(args: {
  name: string;
  prompt: string;
  intervalMinutes: number;
  maxRuns?: number;
}): string {
  const id = `cron-${nextJobId++}`;
  const intervalMs = args.intervalMinutes * 60 * 1000;

  const job: CronJob = {
    id,
    name: args.name,
    prompt: args.prompt,
    intervalMs,
    enabled: true,
    maxRuns: args.maxRuns,
    runCount: 0,
  };

  // Start the interval
  job.timerId = setInterval(() => runCronJob(job), intervalMs);
  job.nextRun = new Date(Date.now() + intervalMs).toISOString();

  jobs.set(id, job);

  console.log(
    chalk.dim(
      `\n  ⏰ Cron "${args.name}" scheduled every ${args.intervalMinutes}m`
    )
  );

  return `Cron job created: "${args.name}" (${id}) — runs every ${args.intervalMinutes} minutes. ${args.maxRuns ? `Max ${args.maxRuns} runs.` : "Runs indefinitely."}`;
}

export function deleteCronJob(id: string): string {
  const job = jobs.get(id);
  if (!job) return `Cron job "${id}" not found.`;

  if (job.timerId) clearInterval(job.timerId);
  jobs.delete(id);
  return `Cron job "${job.name}" (${id}) deleted.`;
}

export function listCronJobs(): string {
  if (jobs.size === 0) return "No cron jobs scheduled.";

  const lines: string[] = [];
  for (const job of jobs.values()) {
    const status = job.enabled ? "✓ active" : "✗ paused";
    const interval = Math.round(job.intervalMs / 60000);
    lines.push(
      `  ${job.id} | ${status} | "${job.name}" | every ${interval}m | runs: ${job.runCount}${job.maxRuns ? `/${job.maxRuns}` : ""} | last: ${job.lastRun ? new Date(job.lastRun).toLocaleTimeString() : "never"}`
    );
  }
  return lines.join("\n");
}

async function runCronJob(job: CronJob): Promise<void> {
  if (!job.enabled) return;

  // Check max runs
  if (job.maxRuns && job.runCount >= job.maxRuns) {
    if (job.timerId) clearInterval(job.timerId);
    job.enabled = false;
    console.log(chalk.dim(`\n  ⏰ Cron "${job.name}" completed (${job.maxRuns} runs).`));
    return;
  }

  job.runCount++;
  job.lastRun = new Date().toISOString();

  console.log(chalk.dim(`\n  ⏰ Cron "${job.name}" running (${job.runCount})...`));

  try {
    const client = createClient();
    const systemContent =
      getSystemPrompt(getCwd()) +
      getCoreMemoryContext() +
      `\n\n# Context: This is a scheduled background task. Complete the task silently and efficiently. Do not ask the user for input.`;

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent },
      {
        role: "user",
        content: `[CRON JOB: ${job.name}]\n${job.prompt}`,
      },
    ];

    await chat(client, messages, (token) => {
      process.stdout.write(chalk.dim(token));
    });

    console.log(chalk.dim(`\n  ⏰ Cron "${job.name}" completed.\n`));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`\n  ⏰ Cron "${job.name}" failed: ${msg}\n`));
  }
}

export function cleanupCrons(): void {
  for (const job of jobs.values()) {
    if (job.timerId) clearInterval(job.timerId);
  }
  jobs.clear();
}
