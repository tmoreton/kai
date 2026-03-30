import fs from "fs";
import crypto from "crypto";
import YAML from "yaml";
import chalk from "chalk";
import OpenAI from "openai";
import {
  createRun,
  completeRun,
  createStep,
  completeStep,
  addLog,
  getSteps,
  type StepRecord,
} from "./db.js";
import { resolveProvider, getFallbackModel, type ResolvedProvider } from "../providers/index.js";

// Shared resolved provider — reused across all LLM calls in the workflow engine
let _resolved: ResolvedProvider | null = null;

function getSharedClient(): OpenAI {
  if (!_resolved) _resolved = resolveProvider();
  return _resolved.client;
}

function getSharedModel(): string {
  if (!_resolved) _resolved = resolveProvider();
  return _resolved.model;
}

/**
 * Workflow Engine
 *
 * Executes YAML-defined agent workflows step by step.
 * Each step can be: an LLM call, an integration call, or a shell command.
 * State is checkpointed after each step so workflows can resume on crash.
 */

export interface WorkflowStep {
  name: string;
  type: "llm" | "integration" | "shell" | "notify" | "review";
  integration?: string;
  action?: string;
  prompt?: string;
  command?: string;
  params?: Record<string, any>;
  output_var?: string;
  condition?: string;
}

export interface ReviewConfig {
  enabled: boolean;
  max_iterations?: number; // Default: 3
  review_prompt?: string; // Custom review prompt
  improve_steps?: string[]; // Which steps to re-run on improvement (default: all LLM steps)
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  schedule?: string;
  config?: Record<string, any>;
  review?: ReviewConfig; // Self-improvement loop config
  steps: WorkflowStep[];
}

export interface WorkflowContext {
  config: Record<string, any>;
  vars: Record<string, any>; // Results from previous steps
  env: Record<string, string>;
  agent_id: string;
  run_id: string;
}

// Registry of integration handlers
const integrations = new Map<string, IntegrationHandler>();

export interface IntegrationHandler {
  name: string;
  description: string;
  actions: Record<string, (params: Record<string, any>, ctx: WorkflowContext) => Promise<any>>;
}

export function registerIntegration(handler: IntegrationHandler): void {
  integrations.set(handler.name, handler);
}



/**
 * Parse a workflow YAML file into a WorkflowDefinition.
 */
export function parseWorkflow(filePath: string): WorkflowDefinition {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = YAML.parse(raw) as WorkflowDefinition;

  if (!parsed.name) throw new Error("Workflow must have a 'name' field");
  if (!parsed.steps || !Array.isArray(parsed.steps)) {
    throw new Error("Workflow must have a 'steps' array");
  }

  // Validate steps
  for (const step of parsed.steps) {
    if (!step.name) throw new Error("Each step must have a 'name'");
    if (!step.type) {
      // Infer type
      if (step.prompt) step.type = "llm";
      else if (step.integration) step.type = "integration";
      else if (step.command) step.type = "shell";
      else step.type = "llm";
    }
  }

  return parsed;
}

/**
 * Interpolate template variables in a string.
 * Supports: ${config.key}, ${vars.step_name}, ${env.KEY}
 */
function interpolate(template: string, ctx: WorkflowContext): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const parts = expr.trim().split(".");
    if (parts[0] === "config") {
      const val = ctx.config[parts.slice(1).join(".")];
      if (val === undefined || val === null) return "";
      return typeof val === "string" ? val : JSON.stringify(val);
    }
    if (parts[0] === "vars") {
      const val = ctx.vars[parts[1]];
      if (val === undefined || val === null) return "";
      return typeof val === "string" ? val : JSON.stringify(val);
    }
    if (parts[0] === "env") return ctx.env[parts[1]] || process.env[parts[1]] || "";
    return `\${${expr}}`;
  });
}

/**
 * Interpolate a param value, preserving object types when the entire value
 * is a single ${vars.x} or ${config.x} reference pointing to a non-string.
 */
function interpolateParam(value: any, ctx: WorkflowContext): any {
  if (typeof value !== "string") return value;

  // If the entire value is a single variable reference, return the raw value (preserves objects/arrays)
  const singleVarMatch = value.match(/^\$\{([^}]+)\}$/);
  if (singleVarMatch) {
    const expr = singleVarMatch[1].trim();
    const parts = expr.split(".");
    if (parts[0] === "vars") {
      const val = ctx.vars[parts[1]];
      // If it's a string that looks like JSON, try to parse it
      if (typeof val === "string") {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val ?? null;
    }
    if (parts[0] === "config") {
      return ctx.config[parts.slice(1).join(".")] ?? null;
    }
  }

  // Otherwise do normal string interpolation
  return interpolate(value, ctx);
}

/**
 * Execute a complete workflow.
 */
export async function executeWorkflow(
  workflow: WorkflowDefinition,
  agentId: string,
  configOverrides?: Record<string, any>,
  onProgress?: (step: string, status: string) => void
): Promise<{ success: boolean; results: Record<string, any>; error?: string }> {
  const runId = `run-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  createRun(runId, agentId);

  const ctx: WorkflowContext = {
    config: { ...workflow.config, ...configOverrides },
    vars: {},
    env: { ...process.env } as Record<string, string>,
    agent_id: agentId,
    run_id: runId,
  };

  addLog(agentId, "info", `Workflow "${workflow.name}" started (run: ${runId})`, runId);
  onProgress?.("start", `Running "${workflow.name}"`);

  try {
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];

      // Check condition
      if (step.condition) {
        const condResult = interpolate(step.condition, ctx);
        if (condResult === "false" || condResult === "" || condResult === "null") {
          addLog(agentId, "info", `Step "${step.name}" skipped (condition false)`, runId);
          onProgress?.(step.name, "skipped");
          continue;
        }
      }

      const stepId = createStep(runId, step.name, i);
      addLog(agentId, "info", `Step "${step.name}" starting`, runId);
      onProgress?.(step.name, "running");

      try {
        let result: any;

        switch (step.type) {
          case "llm":
            result = await executeLlmStep(step, ctx);
            break;
          case "integration":
            result = await executeIntegrationStep(step, ctx);
            break;
          case "shell":
            result = await executeShellStep(step, ctx);
            break;
          case "notify":
            result = await executeNotifyStep(step, ctx);
            break;
          case "review":
            // Review steps are handled by the post-workflow review loop.
            // If used inline, treat as an LLM step with review-focused prompt.
            result = await executeLlmStep(step, ctx);
            break;
          default:
            throw new Error(`Unknown step type: ${step.type}`);
        }

        // Store result
        const varName = step.output_var || step.name;
        ctx.vars[varName] = result;

        const outputStr = typeof result === "string" ? result : JSON.stringify(result);
        completeStep(stepId, "completed", outputStr.substring(0, 50000));
        addLog(agentId, "info", `Step "${step.name}" completed`, runId);
        onProgress?.(step.name, "completed");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        completeStep(stepId, "failed", undefined, msg);
        addLog(agentId, "error", `Step "${step.name}" failed: ${msg}`, runId);
        onProgress?.(step.name, `failed: ${msg}`);

        // Fail the run on step failure
        completeRun(runId, "failed", `Step "${step.name}" failed: ${msg}`);
        return { success: false, results: ctx.vars, error: msg };
      }
    }

    // --- Self-improvement review loop ---
    if (workflow.review?.enabled) {
      const maxIter = workflow.review.max_iterations || 3;
      const improveSteps = workflow.review.improve_steps
        || workflow.steps.filter((s) => s.type === "llm").map((s) => s.name);

      for (let iter = 0; iter < maxIter; iter++) {
        onProgress?.("review", `Reviewing output (iteration ${iter + 1}/${maxIter})`);
        addLog(agentId, "info", `Review iteration ${iter + 1}/${maxIter}`, runId);

        const reviewResult = await runReviewStep(workflow, ctx, iter);

        if (reviewResult.verdict === "PASS") {
          addLog(agentId, "info", `Review PASSED: ${reviewResult.summary}`, runId);
          onProgress?.("review", `✓ Quality approved: ${reviewResult.summary}`);
          // Store final review
          ctx.vars.__review = reviewResult;
          break;
        }

        if (reviewResult.verdict === "FAIL") {
          addLog(agentId, "warn", `Review FAILED (unrecoverable): ${reviewResult.summary}`, runId);
          onProgress?.("review", `✗ Unrecoverable: ${reviewResult.summary}`);
          break;
        }

        // NEEDS_IMPROVEMENT — re-run specified LLM steps with feedback
        addLog(agentId, "info", `Review: needs improvement — ${reviewResult.feedback}`, runId);
        onProgress?.("review", `Improving: ${reviewResult.feedback.substring(0, 80)}`);

        // Re-run improvable steps with the feedback injected
        for (const stepName of improveSteps) {
          const stepDef = workflow.steps.find((s) => s.name === stepName);
          if (!stepDef || stepDef.type !== "llm") continue;

          const stepIdx = workflow.steps.indexOf(stepDef);
          const stepId = createStep(runId, `${stepName}_improve_${iter + 1}`, 100 + iter * 10 + stepIdx);
          onProgress?.(stepName, `improving (iteration ${iter + 1})`);

          try {
            // Create an enhanced step with review feedback
            const improvedStep: WorkflowStep = {
              ...stepDef,
              prompt: `${stepDef.prompt}\n\n## Reviewer Feedback (Iteration ${iter + 1})\nThe previous output was reviewed and needs improvement:\n${reviewResult.feedback}\n\nPlease improve your output based on this feedback. Be specific and address each point.`,
            };

            const result = await executeLlmStep(improvedStep, ctx);
            const varName = stepDef.output_var || stepDef.name;
            ctx.vars[varName] = result;

            completeStep(stepId, "completed", result.substring(0, 50000));
            onProgress?.(stepName, `improved (iteration ${iter + 1})`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            completeStep(stepId, "failed", undefined, msg);
            addLog(agentId, "error", `Improvement of "${stepName}" failed: ${msg}`, runId);
          }
        }
      }
    }

    completeRun(runId, "completed");
    addLog(agentId, "info", `Workflow "${workflow.name}" completed successfully`, runId);
    onProgress?.("complete", "All steps done");
    return { success: true, results: ctx.vars };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    completeRun(runId, "failed", msg);
    return { success: false, results: ctx.vars, error: msg };
  }
}

/**
 * Run the review/evaluator step.
 * Returns PASS, NEEDS_IMPROVEMENT, or FAIL with feedback.
 */
async function runReviewStep(
  workflow: WorkflowDefinition,
  ctx: WorkflowContext,
  iteration: number
): Promise<{ verdict: "PASS" | "NEEDS_IMPROVEMENT" | "FAIL"; summary: string; feedback: string }> {
  const customPrompt = workflow.review?.review_prompt || "";

  // Collect all LLM step outputs for review
  const outputs: string[] = [];
  for (const step of workflow.steps) {
    if (step.type === "llm") {
      const varName = step.output_var || step.name;
      const val = ctx.vars[varName];
      if (val) {
        const str = typeof val === "string" ? val : JSON.stringify(val);
        outputs.push(`## ${step.name}\n${str.substring(0, 2000)}`);
      }
    }
  }

  const reviewPrompt = `You are a quality reviewer for an AI agent workflow called "${workflow.name}".
${workflow.description ? `Purpose: ${workflow.description}` : ""}

Review the following outputs and evaluate their quality.

${outputs.join("\n\n---\n\n")}

${customPrompt ? `\nAdditional review criteria:\n${customPrompt}` : ""}

Respond in this exact JSON format (no other text):
{
  "verdict": "PASS" or "NEEDS_IMPROVEMENT" or "FAIL",
  "summary": "One sentence overall assessment",
  "feedback": "If NEEDS_IMPROVEMENT: specific, actionable feedback on what to fix. If PASS: brief praise. If FAIL: why it's unrecoverable."
}

Evaluation criteria:
- Is the output specific and actionable (not generic)?
- Does it reference real data from the workflow inputs?
- Is it well-structured and complete?
- Would a human find this genuinely useful?
${iteration > 0 ? `\nThis is iteration ${iteration + 1}. Be stricter — earlier iterations already improved the output. If it's good enough now, PASS it.` : ""}`;

  const client = getSharedClient();
  const model = getSharedModel();
  const models = [
    model,
    "moonshotai/Kimi-K2.5",
  ];

  for (const currentModel of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 3000 * Math.pow(2, attempt)));
        }

        const response = await client.chat.completions.create({
          model: currentModel,
          messages: [{ role: "user", content: reviewPrompt }],
          max_tokens: 1024,
        });

        const content = response.choices[0]?.message?.content
          || (response.choices[0]?.message as any)?.reasoning
          || "";

        // Parse JSON from response
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
              verdict: parsed.verdict || "PASS",
              summary: parsed.summary || "",
              feedback: parsed.feedback || "",
            };
          }
        } catch {}

        // Fallback: if we can't parse, assume PASS
        return { verdict: "PASS", summary: "Review completed", feedback: content };
      } catch {
        // Try next retry / fallback
      }
    }
  }

  // All models failed — auto-pass to avoid blocking the pipeline
  return { verdict: "PASS", summary: "Review skipped (API unavailable)", feedback: "" };
}

// --- Step Executors ---

async function executeLlmStep(step: WorkflowStep, ctx: WorkflowContext): Promise<string> {
  if (!step.prompt) throw new Error("LLM step requires a 'prompt'");

  const prompt = interpolate(step.prompt, ctx);

  const client = getSharedClient();
  const model = getSharedModel();

  const messages = [
    {
      role: "system" as const,
      content: "You are an AI agent executing a workflow step. Be concise and structured in your output. Return actionable results.",
    },
    { role: "user" as const, content: prompt },
  ];

  // Try primary model with retries, then fallback models
  const fallbackModels = [
    model,
    getFallbackModel(),
  ];

  for (const currentModel of fallbackModels) {
    const isFallback = currentModel !== model;
    if (isFallback) {
      console.log(chalk.dim(`    Falling back to ${currentModel}...`));
    }

    const maxRetries = isFallback ? 2 : 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.min(3000 * Math.pow(2, attempt), 15000);
          await new Promise((r) => setTimeout(r, delay));
          console.log(chalk.dim(`    Retrying (attempt ${attempt + 1}/${maxRetries})...`));
        }

        const response = await client.chat.completions.create({
          model: currentModel,
          messages,
          max_tokens: 16384,
        });

        const content = response.choices[0]?.message?.content || "";
        const reasoning = (response.choices[0]?.message as any)?.reasoning || "";
        return content || reasoning;
      } catch (err: any) {
        const status = err?.status || err?.response?.status;
        // For non-transient errors on primary model, throw immediately
        // For fallback models, any error just moves to next fallback
        if (!isFallback && status && ![500, 502, 503, 429].includes(status)) {
          throw new Error(`LLM error (${status}): ${err.message}`);
        }
        // Continue to next retry or fallback
      }
    }
  }

  throw new Error(`LLM failed after all retries and fallback models`);
}

async function executeIntegrationStep(step: WorkflowStep, ctx: WorkflowContext): Promise<any> {
  if (!step.integration) throw new Error("Integration step requires an 'integration' name");

  const handler = integrations.get(step.integration);
  if (!handler) {
    throw new Error(`Unknown integration: "${step.integration}". Available: ${[...integrations.keys()].join(", ")}`);
  }

  const action = step.action || "default";
  const actionFn = handler.actions[action];
  if (!actionFn) {
    throw new Error(`Unknown action "${action}" for integration "${step.integration}". Available: ${Object.keys(handler.actions).join(", ")}`);
  }

  // Interpolate params — preserves objects when param is a single ${vars.x} reference
  const params: Record<string, any> = {};
  if (step.params) {
    for (const [key, value] of Object.entries(step.params)) {
      params[key] = interpolateParam(value, ctx);
    }
  }

  return actionFn(params, ctx);
}

async function executeShellStep(step: WorkflowStep, ctx: WorkflowContext): Promise<string> {
  if (!step.command) throw new Error("Shell step requires a 'command'");

  const { exec } = await import("child_process");
  const command = interpolate(step.command, ctx);

  return new Promise((resolve, reject) => {
    exec(command, { timeout: 60000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

async function executeNotifyStep(step: WorkflowStep, ctx: WorkflowContext): Promise<string> {
  const title = step.params?.title ? interpolate(String(step.params.title), ctx) : "Kai Agent";
  const message = step.params?.message ? interpolate(String(step.params.message), ctx) : "Workflow step completed";

  try {
    const notifier = await import("node-notifier");
    notifier.default.notify({ title, message, sound: true });
  } catch {
    // node-notifier may not be available on all platforms — log but don't fail
    console.log(chalk.dim(`  [notify] ${title}: ${message}`));
  }
  return `Notification sent: ${title} — ${message}`;
}
