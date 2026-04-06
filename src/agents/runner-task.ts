/**
 * Task Runner — Run-to-Completion Mode
 * 
 * Executes agents in a loop until the task is complete,
 * rather than running on a schedule.
 */

import { getAgent, addLog } from "../agents-core/db.js";
import { parseWorkflow, executeWorkflow, type WorkflowDefinition, type WorkflowStep } from "../agents-core/workflow.js";
import { loadPersona } from "../agent-persona.js";
import { createClient, chat, getModelId } from "../client.js";
import { ensureGlobalDir } from "../project.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import path from "path";
import fs from "fs";
import crypto from "crypto";

interface TaskOptions {
  maxIterations?: number;
  approveCost?: number;
  outputDir?: string;
  onProgress?: (iteration: number, action: string, status: string) => void;
}

interface TaskResult {
  success: boolean;
  reason?: string;
  summary: string;
  outputDir?: string;
  partialResults?: boolean;
  iterations: number;
  actions: string[];
}

interface CompletionCheck {
  complete: boolean;
  confidence: number;
  missing: string[];
  quality: "ready" | "needs_work" | "excellent";
  nextAction: "stop" | "refine" | "expand" | "continue";
  reason: string;
}

/**
 * Run an agent in task mode — execute until completion
 */
export async function runUntilComplete(
  agentId: string,
  prompt: string,
  options: TaskOptions = {}
): Promise<TaskResult> {
  const agent = getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  const maxIterations = options.maxIterations || 20;
  const outputDir = options.outputDir || path.join(
    ensureGlobalDir("runs"),
    `${Date.now()}-${agentId}`
  );
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Load workflow
  const workflow = parseWorkflow(agent.workflow_path);
  if (!workflow) {
    throw new Error(`Failed to load workflow from ${agent.workflow_path}`);
  }

  // Load persona
  const config = JSON.parse(agent.config || "{}");
  const personaId = config.personaId || agentId;
  const persona = loadPersona(personaId);

  const client = createClient();
  
  // Variable context for workflow steps
  const context = {
    input: { prompt, agentId, timestamp: new Date().toISOString() },
    vars: {} as Record<string, any>,
    config: workflow.config || {},
  };
  
  // Task state
  const iterations: Array<{
    iteration: number;
    action: string;
    result: any;
    timestamp: string;
  }> = [];
  
  let completed = false;
  let iteration = 0;
  let completionCheck: CompletionCheck | null = null;

  console.log(`Starting task execution (max ${maxIterations} iterations)...\n`);

  // Main execution loop
  while (!completed && iteration < maxIterations) {
    iteration++;

    // 1. Plan next action
    const plan = await planNextAction(client, prompt, workflow, persona, iterations, context);
    
    if (options.onProgress) {
      options.onProgress(iteration, plan.action, "planning");
    }

    console.log(`[${iteration}/${maxIterations}] ${plan.action}`);
    console.log(`  → ${plan.description}`);

    // 2. Execute the step
    let result: any = null;
    try {
      result = await executeTaskStep(plan, workflow, agent, outputDir, context);
      
      // Store result in context for future steps
      if (plan.stepName) {
        context.vars[plan.stepName] = result.output || result;
      }
      if (result.output_var) {
        context.vars[result.output_var] = result.output;
      }
      
      console.log(`  ✓ Complete`);
    } catch (err) {
      console.log(`  ✗ Failed: ${err instanceof Error ? err.message : String(err)}`);
      result = { error: String(err) };
    }

    // 3. Record iteration
    iterations.push({
      iteration,
      action: plan.action,
      result,
      timestamp: new Date().toISOString(),
    });

    // 4. Check completion
    completionCheck = await checkCompletion(client, prompt, iterations, persona, context);
    
    if (completionCheck.complete) {
      completed = true;
      console.log(`\n✅ Task complete (${completionCheck.confidence}% confidence)`);
    } else {
      console.log(`  → ${completionCheck.reason}`);
      if (completionCheck.nextAction === "stop") {
        break; // Agent decided to stop
      }
    }
  }

  // 5. Generate final summary
  const summary = await generateSummary(client, prompt, iterations, completionCheck, persona);

  // 6. Save task record
  const taskRecord = {
    agentId,
    prompt,
    startedAt: iterations[0]?.timestamp || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    iterations,
    completionCheck,
    summary,
  };
  
  fs.writeFileSync(
    path.join(outputDir, "task-record.json"),
    JSON.stringify(taskRecord, null, 2)
  );

  return {
    success: completed,
    reason: completed ? undefined : completionCheck?.reason || `Max iterations (${maxIterations}) reached`,
    summary,
    outputDir,
    partialResults: !completed && iterations.length > 0,
    iterations: iterations.length,
    actions: iterations.map(i => i.action),
  };
}

/**
 * Plan the next action based on current state
 */
async function planNextAction(
  client: any,
  prompt: string,
  workflow: WorkflowDefinition,
  persona: any,
  iterations: Array<{ iteration: number; action: string; result: any }>,
  context: { input: any; vars: Record<string, any>; config: any }
): Promise<{
  action: string;
  description: string;
  stepName?: string;
}> {
  
  const recentActions = iterations.slice(-5).map(i => 
    `- ${i.action}: ${i.result?.success !== false ? 'success' : 'failed'}`
  ).join("\n") || "No actions yet";

  const systemPrompt = persona 
    ? `${persona.personality}\n\nYou are ${persona.name}. ${persona.role}`
    : "You are a helpful AI assistant that executes tasks step by step.";

  const planningPrompt = `${systemPrompt}

Original task: ${prompt}

Workflow available steps:
${workflow.steps.map((s, i) => `${i + 1}. ${s.name} (${s.type})`).join("\n")}

Recent actions:
${recentActions}

What is the single most impactful next action to move toward completing the task?

Consider:
1. What have we already accomplished?
2. What's the logical next step?
3. Which workflow step should we execute?
4. Why this action now?

Return JSON:
{
  "action": "descriptive name of the action",
  "description": "brief explanation of what we're doing and why",
  "stepName": "which workflow step to execute (match the step name exactly)",
  "estimatedOutcome": "what we expect to achieve"
}`;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: planningPrompt }
  ];
  
  const response = await client.chat.completions.create({
    model: getModelId(),
    messages,
    temperature: 0.3,
  });

  try {
    const content = response.choices[0]?.message?.content || ""; 
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const plan = JSON.parse(match[0]);
      return {
        action: plan.action || plan.stepName || "execute step",
        description: plan.description || "Executing workflow step",
        stepName: plan.stepName,
      };
    }
  } catch {}

  // Fallback: return first unexecuted step
  const executedSteps = new Set(iterations.map(i => i.action));
  const nextStep = workflow.steps.find(s => !executedSteps.has(s.name));
  
  return {
    action: nextStep?.name || "continue execution",
    description: nextStep?.prompt?.substring(0, 100) || "Proceeding with workflow",
    stepName: nextStep?.name,
  };
}

/**
 * Execute a single workflow step for the task
 */
async function executeTaskStep(
  plan: { action: string; description: string; stepName?: string },
  workflow: WorkflowDefinition,
  agent: any,
  outputDir: string,
  context: { input: any; vars: Record<string, any>; config: any }
): Promise<any> {
  // Find the step in workflow
  let step = workflow.steps.find(s => s.name === plan.stepName);
  
  // If no specific step, find by type or use first available
  if (!step) {
    step = workflow.steps.find(s => s.type === "llm" || s.type === "skill");
  }
  
  if (!step) {
    throw new Error("No executable step found in workflow");
  }

  // Substitute variables in prompt
  let prompt = step.prompt || "";
  
  // Replace ${input.X} with context.input.X
  prompt = prompt.replace(/\$\{input\.([^}]+)\}/g, (match, key) => {
    return context.input[key] || match;
  });
  
  // Replace ${vars.X} or ${context.vars.X} with context.vars.X
  prompt = prompt.replace(/\$\{(?:vars|context\.vars)\.([^}]+)\}/g, (match, key) => {
    const value = context.vars[key];
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value || match);
  });
  
  // Replace ${config.X} with workflow config
  prompt = prompt.replace(/\$\{config\.([^}]+)\}/g, (match, key) => {
    return context.config[key] || match;
  });

  // For now, execute LLM steps directly
  if (step.type === "llm" && prompt) {
    const client = createClient();
    
    const response = await client.chat.completions.create({
      model: getModelId(),
      messages: [
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || "";
    
    // Try to save output if it's structured
    if (step.output_var) {
      const outputFile = path.join(outputDir, `${step.name || plan.stepName}-${Date.now()}.json`);
      fs.writeFileSync(outputFile, JSON.stringify({ output: content, timestamp: new Date().toISOString() }, null, 2));
    }
    
    return { success: true, output: content, output_var: step.output_var };
  }

  // For shell/skill steps, we'd need more infrastructure
  // For now, return a placeholder
  return { success: true, note: "Step type not yet implemented in task mode", output_var: step.output_var };
}

/**
 * Check if the task is complete
 */
async function checkCompletion(
  client: any,
  prompt: string,
  iterations: Array<{ iteration: number; action: string; result: any }>,
  persona: any,
  context: { input: any; vars: Record<string, any>; config: any }
): Promise<CompletionCheck> {
  
  const actions = iterations.map(i => 
    `${i.iteration}. ${i.action}: ${JSON.stringify(i.result).substring(0, 200)}`
  ).join("\n");

  const systemPrompt = persona
    ? `${persona.personality}\n\nEvaluate task completion objectively.`
    : "Evaluate whether the task is complete and ready for review.";

  const checkPrompt = `${systemPrompt}

Original task: ${prompt}

Actions taken:
${actions}

Context variables available:
${Object.keys(context.vars).map(k => `- ${k}: ${typeof context.vars[k] === 'string' ? context.vars[k].substring(0, 100) : 'object'}`).join('\n')}

Evaluate completion:
1. Does this fulfill the original request?
2. Is the output ready for human review?
3. What's missing (if anything)?
4. Should we continue, refine, or stop?

Return JSON:
{
  "complete": true|false,
  "confidence": 0-100,
  "missing": ["item 1", "item 2"],
  "quality": "ready|needs_work|excellent",
  "nextAction": "stop|refine|expand|continue",
  "reason": "brief explanation of the decision"
}`;

  const checkMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: checkPrompt }
  ];
  
  const response = await client.chat.completions.create({
    model: getModelId(),
    messages: checkMessages,
    temperature: 0.2,
  });

  try {
    const content = response.choices[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const result = JSON.parse(match[0]);
      return {
        complete: result.complete || false,
        confidence: result.confidence || 50,
        missing: result.missing || [],
        quality: result.quality || "needs_work",
        nextAction: result.nextAction || "continue",
        reason: result.reason || "Evaluating...",
      };
    }
  } catch {}

  // Default: continue if we haven't done much
  return {
    complete: iterations.length > 5,
    confidence: 50,
    missing: [],
    quality: "needs_work",
    nextAction: "continue",
    reason: iterations.length > 5 ? "Multiple iterations completed, evaluating..." : "Still working...",
  };
}

/**
 * Generate final summary of the task
 */
async function generateSummary(
  client: any,
  prompt: string,
  iterations: Array<{ iteration: number; action: string; result: any }>,
  completionCheck: CompletionCheck | null,
  persona: any
): Promise<string> {
  
  const systemPrompt = persona
    ? `${persona.personality}\n\nSummarize the completed task.`
    : "Summarize what was accomplished.";

  const actions = iterations.map(i => `- ${i.action}`).join("\n");

  const summaryPrompt = `${systemPrompt}

Original task: ${prompt}

Actions completed:
${actions}

Completion status: ${completionCheck?.complete ? "Complete" : "Partial"}
Quality: ${completionCheck?.quality}

Write a concise summary (3-5 sentences) of:
1. What was accomplished
2. Key outputs created
3. What the user should review
4. Next steps (if any)

Be specific and actionable.`;

  const summaryMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: summaryPrompt }
  ];
  
  const response = await client.chat.completions.create({
    model: getModelId(),
    messages: summaryMessages,
    temperature: 0.5,
  });

  const content = response.choices[0]?.message?.content || "";
  return content.trim();
}
