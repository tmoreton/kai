import fs from "fs";
import path from "path";
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
  saveRunRecap,
  createNotification,
  getPreviousRuns,
  getRunOutputsForComparison,
  createApproval,
  getPendingApprovals,
  resolveApproval,
  hasPendingApprovals,
  type StepRecord,
} from "./db.js";
import { saveCheckpoint, cleanupCheckpoints } from "../agents/checkpoint.js";
import { resolveProvider, resolveProviderWithFallback, type ResolvedProvider } from "../providers/index.js";
import { backoffDelay, sleep } from "../utils.js";
import { getSkill } from "../skills/loader.js";
import {
  RETRYABLE_STATUS_CODES,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_BASE_URL,
  WORKFLOW_STEP_OUTPUT_LIMIT,
  WORKFLOW_REVIEW_OUTPUT_LIMIT,
  SHELL_STEP_TIMEOUT,
  SHELL_STEP_MAX_BUFFER,
} from "../constants.js";

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

/** Build an OpenRouter fallback client for workflow LLM calls */
function getFallbackProvider(): { client: OpenAI; model: string } | null {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  return {
    client: new OpenAI({
      apiKey: key,
      baseURL: DEFAULT_OPENROUTER_BASE_URL,
    }),
    model: DEFAULT_OPENROUTER_MODEL,
  };
}

/**
 * Workflow Engine
 *
 * Executes YAML-defined agent workflows step by step.
 * Each step can be: an LLM call, a skill call, an integration call (deprecated), or a shell command.
 * State is checkpointed after each step so workflows can resume on crash.
 */

export interface WorkflowStep {
  name: string;
  type: "llm" | "skill" | "integration" | "shell" | "notify" | "review" | "approval" | "parallel";
  /**
   * @deprecated Use 'skill' instead of 'integration'. The integration system is deprecated.
   */
  integration?: string;
  skill?: string;       // skill ID to call
  action?: string;      // action/skill tool to call
  tool?: string;        // alias for action
  prompt?: string;
  command?: string;
  params?: Record<string, any>;
  output_var?: string;
  condition?: string;
  stream?: boolean;
  max_tokens?: number;
  auto_approve?: boolean;
  steps?: WorkflowStep[];
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
  trigger_reason?: string; // "manual", "cron", "heartbeat"
  history?: {
    previous_runs: Array<{ status: string; started_at: string; id: string }>;
    compare_outputs: (stepName: string, limit?: number) => Array<{ output: string; created_at: string }>;
  };
}

// Registry of integration handlers
/**
 * @deprecated Use the skill system instead. The integration registry is kept for backward compatibility.
 */
const integrations = new Map<string, IntegrationHandler>();

/**
 * @deprecated Use the skill system instead. Integration handlers are deprecated.
 */
export interface IntegrationHandler {
  name: string;
  description: string;
  actions: Record<string, (params: Record<string, any>, ctx: WorkflowContext) => Promise<any>>;
}

/**
 * Register an integration handler.
 *
 * @deprecated Use the skill system instead. This function is kept for backward compatibility.
 *   For new integrations, create a skill manifest in ~/.kai/skills/<skill-id>/skill.yaml
 */
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
      if (step.steps && Array.isArray(step.steps)) step.type = "parallel";
      else if (step.prompt) step.type = "llm";
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
    if (parts[0] === "history") {
      if (parts[1] === "previous_runs" && parts[2]) {
        const idx = parseInt(parts[2]);
        const run = ctx.history?.previous_runs[idx];
        if (!run) return "";
        if (parts[3] === "output" && run.id) {
          const outputs = ctx.history?.compare_outputs("", 5) || [];
          const match = outputs.find(o => o.created_at === run.started_at);
          return match?.output || "";
        }
        return JSON.stringify(run);
      }
      if (parts[1] === "yesterday" && ctx.history) {
        // Special accessor for yesterday comparison
        const yesterday = ctx.history.compare_outputs("", 2)[1];
        return yesterday?.output || "";
      }
      return "";
    }
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
 * 
 * Supports durable execution with automatic checkpointing. If a run crashes,
 * it can be resumed from the last completed step by passing resumeFrom.
 */
export async function executeWorkflow(
  workflow: WorkflowDefinition,
  agentId: string,
  configOverrides?: Record<string, any>,
  onProgress?: (step: string, status: string) => void,
  options?: { resumeFrom?: string }
): Promise<{ success: boolean; results: Record<string, any>; error?: string; runId?: string }> {
  
  // Load existing checkpoint or start fresh
  let runId: string = "";
  let ctx: WorkflowContext = {
    config: {},
    vars: {},
    env: {},
    agent_id: agentId,
    run_id: "",
    history: {
      previous_runs: [],
      compare_outputs: () => [],
    },
  };
  let startStep = 0;
  let isResuming = false;
  
  if (options?.resumeFrom) {
    // Attempt to resume from checkpoint
    const { getLatestCheckpoint } = await import("../agents/checkpoint.js");
    const checkpoint = getLatestCheckpoint(options.resumeFrom);
    
    if (checkpoint) {
      runId = options.resumeFrom;
      try {
        const savedCtx = JSON.parse(checkpoint.context);
        ctx = {
          config: savedCtx.config || {},
          vars: savedCtx.vars || {},
          env: { ...process.env } as Record<string, string>,
          agent_id: agentId,
          run_id: runId,
          history: {
            previous_runs: getPreviousRuns(agentId, runId, 5),
            compare_outputs: (stepName: string, limit = 5) => getRunOutputsForComparison(agentId, stepName, limit),
          },
        };
        startStep = checkpoint.stepIndex;
        isResuming = true;
        addLog(agentId, "info", `Resuming workflow "${workflow.name}" from step ${startStep} (run: ${runId})`, runId);
      } catch (err) {
        // Failed to parse checkpoint, start fresh
        addLog(agentId, "warn", `Failed to load checkpoint for ${options.resumeFrom}, starting fresh`, options.resumeFrom);
        // Fall through to fresh run creation below
      }
    } else {
      // No checkpoint found, start fresh with the provided runId
      addLog(agentId, "warn", `No checkpoint found for ${options.resumeFrom}, starting fresh`, options.resumeFrom);
      // Fall through to fresh run creation below
    }
  }
  
  // If not resuming (either no resumeFrom or no checkpoint), create fresh run
  if (!isResuming) {
    runId = options?.resumeFrom || `run-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    createRun(runId, agentId);
    
    ctx = {
      config: { ...workflow.config, ...configOverrides },
      vars: {},
      env: { ...process.env } as Record<string, string>,
      agent_id: agentId,
      run_id: runId,
      history: {
        previous_runs: getPreviousRuns(agentId, runId, 5),
        compare_outputs: (stepName: string, limit = 5) => getRunOutputsForComparison(agentId, stepName, limit),
      },
    };
  }

  // Track all files created during this run
  const createdFiles: string[] = [];

  onProgress?.("start", isResuming ? `Resuming "${workflow.name}"` : `Running "${workflow.name}"`);

  try {
    for (let i = startStep; i < workflow.steps.length; i++) {
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
      
      // Checkpoint: Save state BEFORE executing the step
      const checkpointContext = {
        config: ctx.config,
        vars: ctx.vars,
        env: ctx.env,
        agent_id: ctx.agent_id,
        run_id: ctx.run_id,
        trigger_reason: ctx.trigger_reason,
      };
      saveCheckpoint(runId, i, checkpointContext);
      
      addLog(agentId, "info", `Step "${step.name}" starting`, runId);
      onProgress?.(step.name, "running");

      try {
        let result: any;

        switch (step.type) {
          case "llm":
            result = await executeLlmStep(step, ctx);
            break;
          case "skill":
            result = await executeSkillStep(step, ctx);
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
          case "parallel":
            result = await executeParallelStep(step, ctx, agentId, runId, onProgress);
            break;
          case "approval":
            result = await executeApprovalStep(step, ctx, stepId);
            // If still pending, halt workflow gracefully
            if (result === "__PENDING_APPROVAL__") {
              completeRun(runId, "paused", `Awaiting approval for step: ${step.name}`);
              return { success: true, results: ctx.vars, error: `Paused for approval: ${step.name}`, runId };
            }
            break;
          default:
            throw new Error(`Unknown step type: ${step.type}`);
        }

        // Store result
        const varName = step.output_var || step.name;
        ctx.vars[varName] = result;

        // Track files created by integration steps (data write, image_gen, etc.)
        if (step.type === "integration" || step.type === "shell") {
          const extractedFiles = extractFilePathsFromResult(result);
          for (const filePath of extractedFiles) {
            if (!createdFiles.includes(filePath)) {
              createdFiles.push(filePath);
            }
          }
        }

        const outputStr = typeof result === "string" ? result : JSON.stringify(result);
        completeStep(stepId, "completed", outputStr.substring(0, WORKFLOW_STEP_OUTPUT_LIMIT));
        addLog(agentId, "info", `Step "${step.name}" completed`, runId);
        onProgress?.(step.name, "completed");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        completeStep(stepId, "failed", undefined, msg);
        addLog(agentId, "error", `Step "${step.name}" failed: ${msg}`, runId);
        onProgress?.(step.name, `failed: ${msg}`);

        // Fail the run on step failure
        completeRun(runId, "failed", `Step "${step.name}" failed: ${msg}`);
        return { success: false, results: ctx.vars, error: msg, runId };
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

            completeStep(stepId, "completed", result.substring(0, WORKFLOW_STEP_OUTPUT_LIMIT));
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

    // Store created files in context for recap to access
    ctx.vars.__createdFiles = createdFiles;

    // Save final checkpoint with completed status and cleanup old ones
    saveCheckpoint(runId, workflow.steps.length, {
      config: ctx.config,
      vars: ctx.vars,
      env: ctx.env,
      agent_id: ctx.agent_id,
      run_id: ctx.run_id,
      trigger_reason: ctx.trigger_reason,
      status: "completed"
    });
    cleanupCheckpoints(runId);

    // Generate and cache recap + create notification (non-blocking)
    generateAndCacheRecap(runId, agentId, workflow.name, createdFiles).catch(() => {});

    return { success: true, results: ctx.vars, runId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    completeRun(runId, "failed", msg);

    // Create failure notification
    createNotification({
      type: "agent_failed",
      title: `${workflow.name} failed`,
      body: msg,
      agentId,
      runId,
    });

    return { success: false, results: ctx.vars, error: msg, runId };
  }
}

/**
 * Generate an LLM recap of a completed run, cache it in the DB, and create a notification.
 */
async function generateAndCacheRecap(runId: string, agentId: string, workflowName: string, createdFiles: string[] = []): Promise<void> {
  const steps = getSteps(runId);
  const completedSteps = steps.filter((s) => s.status === "completed" && s.output);
  if (completedSteps.length === 0) return;

  const keyOutputs = completedSteps.map((s) =>
    `## ${s.step_name}\n${(s.output || "").substring(0, 3000)}`
  );

  // Build attachments summary for the recap
  const attachmentsSummary = createdFiles.length > 0
    ? `\n\n**Files Created (${createdFiles.length}):**\n${createdFiles.map(f => `- ${f}`).join("\n")}`
    : "";

  // Build provider list: primary + OpenRouter fallback
  const recapProviders: { client: OpenAI; model: string }[] = [
    { client: getSharedClient(), model: getSharedModel() },
  ];
  const recapFallback = getFallbackProvider();
  if (recapFallback) recapProviders.push(recapFallback);

  let recapGenerated = false;
  for (const provider of recapProviders) {
    try {
      const response = await provider.client.chat.completions.create({
        model: provider.model,
        messages: [
          {
            role: "system",
            content: "You are presenting the final output of an AI agent workflow run to the user. Focus on the ACTUAL CONTENT and END RESULTS produced — not on describing what the agent is or what it can do. For example, if the agent fetched news articles, show the articles with titles, links, and summaries. If it generated a report, show the report. Present the real data and findings, not meta-commentary about the agent's capabilities or architecture. Be concise, use markdown formatting, and keep it under 300 words.",
          },
          {
            role: "user",
            content: `Present the end results from this "${workflowName}" agent run. Show the actual content produced, not a description of the agent:\n\n${keyOutputs.join("\n\n---\n\n")}${attachmentsSummary}`,
          },
        ],
        max_tokens: 2048,
      });

      const recap = response.choices[0]?.message?.content
        || (response.choices[0]?.message as any)?.reasoning || "";

      if (recap) {
        saveRunRecap(runId, recap);
        createNotification({
          type: "agent_completed",
          title: `${workflowName} completed`,
          body: recap,
          agentId,
          runId,
          attachments: createdFiles.length > 0 ? createdFiles : undefined,
        });
        recapGenerated = true;
      }
      break; // Success — stop trying providers
    } catch {
      // Try next provider
    }
  }

  if (!recapGenerated) {
    // All providers failed — still notify, just without LLM recap
    createNotification({
      type: "agent_completed",
      title: `${workflowName} completed`,
      body: "Run completed successfully." + attachmentsSummary,
      agentId,
      runId,
      attachments: createdFiles.length > 0 ? createdFiles : undefined,
    });
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
        outputs.push(`## ${step.name}\n${str.substring(0, WORKFLOW_REVIEW_OUTPUT_LIMIT)}`);
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

  // Build provider list: primary + OpenRouter fallback
  const providers: { client: OpenAI; model: string }[] = [
    { client: getSharedClient(), model: getSharedModel() },
  ];
  const fallback = getFallbackProvider();
  if (fallback) providers.push(fallback);

  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(backoffDelay(attempt));
        }

        const response = await provider.client.chat.completions.create({
          model: provider.model,
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

  // All providers failed — auto-pass to avoid blocking the pipeline
  return { verdict: "PASS", summary: "Review skipped (API unavailable)", feedback: "" };
}

// --- Step Executors ---

async function executeLlmStep(step: WorkflowStep, ctx: WorkflowContext): Promise<string> {
  if (!step.prompt) throw new Error("LLM step requires a 'prompt'");

  const prompt = interpolate(step.prompt, ctx);

  const primaryClient = getSharedClient();
  const primaryModel = getSharedModel();

  const messages = [
    {
      role: "system" as const,
      content: "You are an AI agent executing a workflow step. Return the ACTUAL CONTENT and RESULTS — not implementation code, technical specifications, or instructions on how to build something. If the task is to fetch articles, return the articles. If the task is to analyze data, return the analysis. Never output source code, API documentation, or deployment guides unless explicitly asked. Be concise and structured.",
    },
    { role: "user" as const, content: prompt },
  ];

  // Build provider list: primary + OpenRouter fallback (if key available)
  const providers: { client: OpenAI; model: string; name: string }[] = [
    { client: primaryClient, model: primaryModel, name: "primary" },
  ];
  const fallback = getFallbackProvider();
  if (fallback) {
    providers.push({ client: fallback.client, model: fallback.model, name: "openrouter" });
  }

  for (const provider of providers) {
    const isFallback = provider.name !== "primary";
    if (isFallback) {
      console.log(chalk.yellow(`    ⚠ Primary LLM failed — falling back to OpenRouter (${provider.model})...`));
    }

    const maxRetries = isFallback ? 2 : 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(backoffDelay(attempt));
          console.log(chalk.dim(`    Retrying (attempt ${attempt + 1}/${maxRetries})...`));
        }

        const response = await provider.client.chat.completions.create({
          model: provider.model,
          messages,
          max_tokens: step.max_tokens ?? 4000,
          stream: step.stream ?? false,
        });

        // Handle streaming vs non-streaming responses
        if (step.stream) {
          let content = "";
          for await (const chunk of response as any) {
            content += chunk.choices[0]?.delta?.content || "";
          }
          return content;
        } else {
          const content = (response as any).choices[0]?.message?.content || "";
          const reasoning = (response as any).choices[0]?.message?.reasoning || "";
          return content || reasoning;
        }
      } catch (err: any) {
        const status = err?.status || err?.response?.status;
        // For non-transient errors on primary, skip to fallback instead of throwing
        if (!isFallback && status && !RETRYABLE_STATUS_CODES.includes(status)) {
          break; // Move to fallback provider
        }
        // Continue to next retry
      }
    }
  }

  throw new Error(`LLM failed after all retries and fallback models`);
}

async function executeSkillStep(step: WorkflowStep, ctx: WorkflowContext): Promise<any> {
  const skillId = step.skill || step.integration;
  if (!skillId) throw new Error("Skill step requires a 'skill' or 'integration' name");

  const skill = getSkill(skillId);
  if (!skill) {
    throw new Error(`Skill "${skillId}" not loaded. Make sure it's in ~/.kai/skills/`);
  }

  const toolName = step.action || step.tool || "default";
  const toolDef = skill.manifest.tools.find((t: any) => t.name === toolName);
  if (!toolDef) {
    const available = skill.manifest.tools.map((t: any) => t.name).join(", ");
    throw new Error(`Tool "${toolName}" not found in skill "${skillId}". Available: ${available}`);
  }

  // Build params from step params
  const params: Record<string, any> = {};
  if (step.params) {
    for (const [key, value] of Object.entries(step.params)) {
      params[key] = interpolateParam(value, ctx);
    }
  }

  // Call the skill action
  const actionFn = skill.handler.actions[toolName];
  if (!actionFn) {
    throw new Error(`Action "${toolName}" not found in skill "${skillId}" handler`);
  }
  
  return await actionFn(params, skill.config);
}

/**
 * Execute an integration step.
 *
 * @deprecated Use executeSkillStep instead. Integration steps are deprecated in favor of skill steps.
 */
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
    exec(command, { timeout: SHELL_STEP_TIMEOUT, maxBuffer: SHELL_STEP_MAX_BUFFER }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

async function executeApprovalStep(step: WorkflowStep, ctx: WorkflowContext, stepId: number): Promise<string> {
  const prompt_text = step.prompt ? interpolate(step.prompt, ctx) : `Approve step: ${step.name}`;

  // Skip if auto_approve is set
  if (step.auto_approve) {
    completeStep(stepId, "completed", "Auto-approved");
    return "Approved (auto)";
  }

  // Check if we already have a pending approval for this step (resuming)
  const pending = getPendingApprovals(ctx.run_id);
  const existing = pending.find(a => a.step_index === stepId);

  if (existing && existing.approved !== null) {
    // We were resumed and have a decision
    const result = existing.approved === 1 ? "Approved" : `Rejected: ${existing.response || ""}`;
    completeStep(stepId, "completed", result);
    return result;
  }

  // Create new approval request
  createApproval({
    runId: ctx.run_id,
    stepIndex: stepId,
    stepName: step.name,
    prompt: prompt_text,
    context: {
      vars: ctx.vars,
      config: ctx.config,
    },
  });

  // Pause the run
  completeStep(stepId, "pending", "Awaiting approval");

  return "__PENDING_APPROVAL__";
}

/**
 * Execute nested steps in parallel via Promise.allSettled.
 * Each sub-step runs independently; results are stored as a combined object.
 */
async function executeParallelStep(
  step: WorkflowStep,
  ctx: WorkflowContext,
  agentId: string,
  runId: string,
  onProgress?: (step: string, status: string) => void
): Promise<Record<string, any>> {
  if (!step.steps || step.steps.length === 0) {
    throw new Error("Parallel step requires a 'steps' array with nested steps");
  }

  onProgress?.(step.name, `running ${step.steps.length} steps in parallel`);

  const promises = step.steps.map(async (subStep) => {
    const subStepId = createStep(runId, `${step.name}/${subStep.name}`, 0);
    onProgress?.(`${step.name}/${subStep.name}`, "running");

    try {
      let result: any;
      switch (subStep.type) {
        case "llm":
          result = await executeLlmStep(subStep, ctx);
          break;
        case "integration":
          result = await executeIntegrationStep(subStep, ctx);
          break;
        case "shell":
          result = await executeShellStep(subStep, ctx);
          break;
        case "notify":
          result = await executeNotifyStep(subStep, ctx);
          break;
        default:
          throw new Error(`Unsupported step type in parallel block: ${subStep.type}`);
      }

      const outputStr = typeof result === "string" ? result : JSON.stringify(result);
      completeStep(subStepId, "completed", outputStr.substring(0, WORKFLOW_STEP_OUTPUT_LIMIT));
      addLog(agentId, "info", `Parallel sub-step "${subStep.name}" completed`, runId);
      onProgress?.(`${step.name}/${subStep.name}`, "completed");

      return { name: subStep.name, status: "fulfilled" as const, result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      completeStep(subStepId, "failed", undefined, msg);
      addLog(agentId, "error", `Parallel sub-step "${subStep.name}" failed: ${msg}`, runId);
      onProgress?.(`${step.name}/${subStep.name}`, `failed: ${msg}`);

      return { name: subStep.name, status: "rejected" as const, error: msg };
    }
  });

  const results = await Promise.allSettled(promises);

  // Unpack results and store each sub-step's output in ctx.vars
  const combined: Record<string, any> = {};
  for (const settled of results) {
    if (settled.status === "fulfilled") {
      const { name, result, status, error } = settled.value;
      const varName = step.steps?.find((s) => s.name === name)?.output_var || name;
      if (status === "fulfilled") {
        ctx.vars[varName] = result;
        combined[varName] = result;
      } else {
        combined[varName] = `[FAILED] ${error}`;
      }
    }
  }

  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value.status === "fulfilled"
  ).length;
  const failed = step.steps.length - succeeded;

  onProgress?.(step.name, `parallel complete: ${succeeded} succeeded, ${failed} failed`);

  return combined;
}

async function executeNotifyStep(step: WorkflowStep, ctx: WorkflowContext): Promise<string> {
  const title = step.params?.title ? interpolate(String(step.params.title), ctx) : "Kai Agent";
  const message = step.params?.message ? interpolate(String(step.params.message), ctx) : "Workflow step completed";

  // Collect file attachments from workflow context
  const attachmentPaths: string[] = [];
  if (step.params?.attachments) {
    const attachmentVar = String(step.params.attachments);
    // Handle variable references like ${vars.thumbnail_path}
    const interpolated = attachmentVar.startsWith("${") ? interpolate(attachmentVar, ctx) : attachmentVar;
    
    // Can be a single path or comma-separated paths
    const paths = interpolated.split(",").map(p => p.trim()).filter(p => p);
    for (const p of paths) {
      if (p && !p.startsWith("${")) {
        attachmentPaths.push(p);
      }
    }
  }

  // Also check for common file output variables in context
  const fileVars = ["thumbnail", "thumbnail_path", "generated_images", "output_file", "script_file", "output_dir", "save_path"];
  for (const varName of fileVars) {
    const val = ctx.vars[varName];
    if (!val || (typeof val === "string" && val.startsWith("${"))) continue;

    // Extract file paths from the value (may be string, JSON string, or object)
    const extracted = extractFilePathsFromResult(
      typeof val === "string" ? tryParseJson(val) ?? val : val
    );
    for (const p of extracted) {
      if (!attachmentPaths.includes(p)) attachmentPaths.push(p);
    }
  }

  // Auto-detect file paths in the message content itself
  const messagePaths = extractFilePathsFromText(message);
  for (const p of messagePaths) {
    if (!attachmentPaths.includes(p)) attachmentPaths.push(p);
  }

  // Convert ~/Desktop/YouTube-Content paths to ~/.kai/output
  const normalizedAttachments = attachmentPaths.map(p => normalizeOutputPath(p));

  // Create notification with attachments
  createNotification({
    type: "agent_run",
    title,
    body: message,
    agentId: ctx.agent_id,
    runId: ctx.run_id,
    attachments: normalizedAttachments.length > 0 ? normalizedAttachments : undefined,
  });

  // Also show desktop notification
  try {
    const notifier = await import("node-notifier");
    notifier.default.notify({ title, message, sound: true });
  } catch {
    // node-notifier may not be available on all platforms — log but don't fail
    console.log(chalk.dim(`  [notify] ${title}: ${message}`));
    if (attachmentPaths.length > 0) {
      console.log(chalk.dim(`  [attachments] ${attachmentPaths.join(", ")}`));
    }
  }
  
  return `Notification sent: ${title} — ${message}${attachmentPaths.length > 0 ? ` (${attachmentPaths.length} file(s) attached)` : ""}`;
}

/**
 * Extract file paths from step results.
 * Handles various result formats from integrations like image_gen, data write, etc.
 */
function tryParseJson(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

function extractFilePathsFromResult(result: any): string[] {
  const paths: string[] = [];
  
  if (!result) return paths;
  
  // Handle string result (single path)
  if (typeof result === "string") {
    // Check if it looks like a path
    if (result.startsWith("/") || result.startsWith("~") || result.startsWith("./")) {
      paths.push(result);
    }
    return paths;
  }
  
  // Handle object result
  if (typeof result === "object") {
    // Check for common file path keys
    const fileKeys = ["written", "path", "appended", "archived", "images", "image", "file", "output_file"];
    for (const key of fileKeys) {
      const val = result[key];
      if (val) {
        if (typeof val === "string") {
          paths.push(val);
        } else if (Array.isArray(val)) {
          // Handle arrays (e.g., images: ["/path/1.png", "/path/2.png"])
          for (const item of val) {
            if (typeof item === "string") {
              paths.push(item);
            }
          }
        }
      }
    }
    
    // Check for nested result structures
    if (result.written && typeof result.written === "object" && result.written.path) {
      paths.push(result.written.path);
    }
    
    // Check for image generation results
    if (result.images && Array.isArray(result.images)) {
      for (const img of result.images) {
        if (typeof img === "string") {
          paths.push(img);
        } else if (img && typeof img === "object" && img.path) {
          paths.push(img.path);
        }
      }
    }
  }
  
  // Filter to only valid-looking paths
  return paths.filter(p => 
    p && 
    typeof p === "string" && 
    (p.startsWith("/") || p.startsWith("~") || p.startsWith("./"))
  );
}

/**
 * Extract file paths from arbitrary text content.
 * Looks for common path patterns like ~/path, /absolute/path, ./relative/path
 */
function extractFilePathsFromText(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  
  const paths: string[] = [];
  
  // Pattern to match file paths:
  // - ~/path (home directory)
  // - /absolute/path
  // - ./relative/path
  // - ../relative/path
  // Match until whitespace, quote, or common punctuation that ends a path
  const pathRegex = /(?:~|\/|\.[\/])[^\s\n\r'"<>|&;{}]+\.[a-zA-Z0-9]+/g;
  
  let match;
  while ((match = pathRegex.exec(text)) !== null) {
    const path = match[0];
    // Filter out false positives - require it looks like a real file path
    if (looksLikeFilePath(path)) {
      paths.push(path);
    }
  }
  
  return [...new Set(paths)]; // Remove duplicates
}

/**
 * Check if a string looks like a valid file path
 */
function looksLikeFilePath(str: string): boolean {
  // Must have an extension (file.txt, image.png, etc.)
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(str);
  if (!hasExtension) return false;
  
  // Must start with ~, /, or ./
  const hasValidPrefix = str.startsWith("~") || str.startsWith("/") || str.startsWith("./") || str.startsWith("../");
  if (!hasValidPrefix) return false;
  
  // Should not contain characters that are unlikely in paths
  const hasInvalidChars = /[<>|&;{}]|\$\{|\$\(|`/.test(str);
  if (hasInvalidChars) return false;
  
  return true;
}

/**
 * Normalize output paths to use ~/.kai/output instead of ~/Desktop/YouTube-Content
 */
function normalizeOutputPath(filePath: string): string {
  if (!filePath || typeof filePath !== "string") return filePath;
  
  const homedir = process.env.HOME || "/tmp";
  
  // Replace ~/Desktop/YouTube-Content with ~/.kai/output
  const oldPathPattern = path.join(homedir, "Desktop", "YouTube-Content");
  if (filePath.startsWith(oldPathPattern) || filePath.includes("Desktop/YouTube-Content")) {
    const newKaiOutput = path.join(homedir, ".kai", "output");
    // If the old path exists as a file/dir, we should note the migration
    // For now, just return the path converted to the new location
    const relativePart = filePath.replace(/.*Desktop[/\\]YouTube-Content[/\\]?/, "");
    return relativePart ? path.join(newKaiOutput, relativePart) : newKaiOutput;
  }
  
  return filePath;
}
