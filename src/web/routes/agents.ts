import { Hono } from "hono";
import fs from "fs";
import path from "path";
import YAML from "yaml";
import {
  listAgents,
  getAgent,
  getLatestRuns,
  getSteps,
  getAgentLogs,
  saveAgent,
  deleteAgent,
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteAllNotifications,
} from "../../agents-core/db.js";
import { runAgent } from "../../agents-core/daemon.js";
import { resumeRun, findInterruptedRunsForDisplay, getResumeStatus } from "../../agents/index.js";

import { createClient, getModelId } from "../../client.js";
import { buildSystemPrompt } from "../../system-prompt.js";
import {
  generateSessionId,
  saveSession,
  type Session,
} from "../../sessions/manager.js";
import { getCwd } from "../../tools/bash.js";
import { ensureKaiDir } from "../../config.js";
import { ensureGlobalDir } from "../../project.js";
import { getLoadedSkills, getSkillToolDefinitions } from "../../skills/loader.js";
import { toolDefinitions, getMcpToolDefinitions } from "../../tools/index.js";
import { executeTool } from "../../tools/executor.js";
import { MAX_TOKENS, MAX_TOOL_TURNS } from "../../constants.js";
import type { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";

function inferAttachmentType(filePath: string): 'image' | 'markdown' | 'file' {
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
    return 'image';
  }
  if (ext === '.md') {
    return 'markdown';
  }
  return 'file';
}

// Helper to infer step type from step properties
function inferStepType(step: any): string {
  if (step.steps && Array.isArray(step.steps)) return 'parallel';
  if (step.prompt) return 'llm';
  if (step.skill || step.integration) return 'skill';
  if (step.command) return 'shell';
  if (step.params?.title || step.params?.message) return 'notify';
  return 'llm';
}

function createNewSession(): Session {
  return {
    id: generateSessionId(),
    cwd: getCwd(),
    type: "chat",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [{ role: "system", content: buildSystemPrompt() }],
  };
}

export function registerAgentRoutes(app: Hono) {
  // --- Agents ---
  app.get("/api/agents", async (c) => {
    const agents = listAgents();

    // Parse workflow files to get steps
    const YAML = await import("yaml");

    return c.json({
      agents: agents.map((a) => {
        const runs = getLatestRuns(a.id, 1);
        const lastRun = runs[0];
        
        // Parse workflow to get steps
        let steps = undefined;
        if (a.workflow_path && fs.existsSync(a.workflow_path)) {
          try {
            const yamlContent = fs.readFileSync(a.workflow_path, "utf-8");
            const workflow = YAML.parse(yamlContent);
            if (workflow.steps && Array.isArray(workflow.steps)) {
              steps = workflow.steps.map((s: any) => ({
                name: s.name,
                type: s.type || inferStepType(s),
                skill: s.skill,
                action: s.action || s.tool,
                prompt: s.prompt,
                command: s.command,
                condition: s.condition,
                output_var: s.output_var,
                params: s.params,
                max_tokens: s.max_tokens,
                auto_approve: s.auto_approve,
                stream: s.stream,
              }));
            }
          } catch (e) {
            // Silently ignore parse errors, steps will be undefined
          }
        }
        
        return {
          id: a.id,
          name: a.name,
          description: a.description,
          schedule: a.schedule,
          enabled: !!a.enabled,
          workflow_path: a.workflow_path,
          steps,
          lastRun: lastRun
            ? {
                id: lastRun.id,
                status: lastRun.status,
                startedAt: lastRun.started_at,
                completedAt: lastRun.completed_at,
                error: lastRun.error,
              }
            : null,
          config: typeof a.config === 'string' ? JSON.parse(a.config || '{}') : (a.config || {}),
        };
      }),
    });
  });


  app.get("/api/agents/:id", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const runs = getLatestRuns(agent.id, 10);
    return c.json({
      ...agent,
      config: JSON.parse(agent.config || "{}"),
      runs: runs.map((r: any) => ({
        id: r.id,
        status: r.status,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        error: r.error,
        trigger: r.trigger,
        recap: r.recap,
      })),
    });
  });

  app.get("/api/agents/:id/output", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const runs = getLatestRuns(agent.id, 1);
    if (runs.length === 0) return c.json({ error: "No runs" }, 404);
    const steps = getSteps(runs[0].id);
    return c.json({
      run: runs[0],
      steps: steps.map((s) => ({
        name: s.step_name,
        status: s.status,
        output: s.output?.substring(0, 5000),
        error: s.error,
        tokensUsed: s.tokens_used,
      })),
    });
  });

  app.post("/api/agents/:id/run", async (c) => {
    const agentId = c.req.param("id");
    const agent = getAgent(agentId);
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    
    // Get latest run to use as the new run ID
    const latestRuns = getLatestRuns(agentId, 1);
    const currentRun = latestRuns[0];
    
    // Trigger agent run asynchronously (fire-and-forget)
    // Don't await the result - it can take minutes
    runAgent(agentId).catch((err) => {
      console.error(`Agent run failed for ${agentId}:`, err);
    });
    
    // Return immediately with success and current/latest run info
    return c.json({ 
      success: true, 
      message: "Agent run started",
      agentId: agentId,
      runId: currentRun?.id,
      status: "running"
    });
  });

  app.patch("/api/agents/:id", async (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.enabled === "boolean") agent.enabled = body.enabled ? 1 : 0;
    if (typeof body.name === "string" && body.name.trim()) agent.name = body.name.trim();
    if (typeof body.description === "string") agent.description = body.description.trim();
    if (typeof body.schedule === "string") agent.schedule = body.schedule.trim();
    
    // Handle config updates (merge with existing)
    if (body.config && typeof body.config === "object") {
      const currentConfig = JSON.parse(agent.config || "{}");
      agent.config = JSON.stringify({ ...currentConfig, ...body.config });
    }
    
    saveAgent(agent);
    return c.json({ id: agent.id, name: agent.name, description: agent.description, schedule: agent.schedule, enabled: !!agent.enabled });
  });

  app.post("/api/agents", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { name, description, schedule, prompt, personaId } = body as {
      name?: string;
      description?: string;
      schedule?: string;
      prompt?: string;
      personaId?: string;
    };

    if (!name || !name.trim()) {
      return c.json({ error: "Name is required" }, 400);
    }
    if (!prompt || !prompt.trim()) {
      return c.json({ error: "Prompt is required" }, 400);
    }

    const id = `agent-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`;

    const existing = getAgent(id);
    if (existing) {
      return c.json({ error: `Agent "${id}" already exists` }, 409);
    }

    const cleanName = name.trim().replace(/"/g, '\\"');
    const cleanDesc = (description || "").trim().replace(/"/g, '\\"');
    const cleanSchedule = (schedule || "").trim();
    const indentedPrompt = prompt.trim().split("\n").map(line => `      ${line}`).join("\n");

    const yaml = [
      `name: "${cleanName}"`,
      `description: "${cleanDesc}"`,
      cleanSchedule ? `schedule: "${cleanSchedule}"` : "",
      `steps:`,
      `  - name: main`,
      `    type: llm`,
      `    prompt: |`,
      indentedPrompt,
    ].filter(Boolean).join("\n") + "\n";

    const workflowsDir = path.join(ensureKaiDir(), "workflows");
    if (!fs.existsSync(workflowsDir)) fs.mkdirSync(workflowsDir, { recursive: true });
    const workflowPath = path.join(workflowsDir, `${id}.yaml`);
    fs.writeFileSync(workflowPath, yaml);

    saveAgent({
      id,
      name: name.trim(),
      description: (description || "").trim(),
      workflow_path: workflowPath,
      schedule: cleanSchedule,
      enabled: 1,
      config: JSON.stringify({ personaId: personaId || null }),
    });

    return c.json({ id, name: name.trim(), description: (description || "").trim(), schedule: cleanSchedule, enabled: true });
  });

  // Generate workflow from natural language description
  app.post("/api/agents/generate", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { description } = body as { description?: string };

    if (!description || !description.trim()) {
      return c.json({ error: "Description is required" }, 400);
    }

    try {
      // Get available skills/tools for context with full tool definitions
      const loadedSkills = getLoadedSkills() as Array<{
        manifest: {
          id: string;
          name: string;
          description?: string;
          tools: Array<{
            name: string;
            description: string;
            parameters?: Record<string, { type: string; description: string; required?: boolean }>;
          }>;
        };
      }>;
      
      const availableTools = loadedSkills.map(s => ({
        id: s.manifest.id,
        name: s.manifest.name,
        description: s.manifest.description || '',
        tools: s.manifest.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters || {},
        })),
      }));
      
      // Build detailed tool documentation for the prompt
      const toolDocumentation = availableTools.map(s => {
        const toolDetails = s.tools.map(t => {
          const params = Object.entries(t.parameters || {});
          const paramDesc = params.length > 0 
            ? '\n      Parameters: ' + params.map(([name, p]) => {
                const required = p.required ? '(required)' : '(optional)';
                return `${name}: ${p.type} ${required} - ${p.description}`;
              }).join(', ')
            : '';
          return `    - ${t.name}: ${t.description}${paramDesc}`;
        }).join('\n');
        return `- ${s.id} (${s.name}):\n${toolDetails}`;
      }).join('\n\n');

      // Get available skill registry (skills that can be installed)
      const registrySkills = [
        { id: 'youtube', name: 'YouTube', description: 'Search, download, and analyze YouTube videos' },
        { id: 'twitter', name: 'Twitter/X', description: 'Post tweets, read timelines, analyze engagement' },
        { id: 'browser', name: 'Browser', description: 'Web scraping, screenshots, form automation' },
        { id: 'notion', name: 'Notion', description: 'Read/write Notion pages and databases' },
        { id: 'slack', name: 'Slack', description: 'Send messages, read channels' },
        { id: 'github', name: 'GitHub', description: 'Read repos, create issues, analyze code' },
        { id: 'linear', name: 'Linear', description: 'Issue tracking and project management' },
        { id: 'stripe', name: 'Stripe', description: 'Payment processing and customer management' },
        { id: 'supabase', name: 'Supabase', description: 'Database operations and auth' },
        { id: 'airtable', name: 'Airtable', description: 'Spreadsheet-style database operations' },
        { id: 'gmail', name: 'Gmail', description: 'Read and send emails' },
        { id: 'google-sheets', name: 'Google Sheets', description: 'Read/write spreadsheet data' },
        { id: 'openrouter', name: 'OpenRouter', description: 'Access to 100+ AI models' },
        { id: 'perplexity', name: 'Perplexity', description: 'AI-powered web search' },
        { id: 'serp', name: 'SerpAPI', description: 'Google search results' },
        { id: 'tavily', name: 'Tavily', description: 'AI search engine for research' },
        { id: 'firecrawl', name: 'Firecrawl', description: 'Website scraping and crawling' },
        { id: 'replicate', name: 'Replicate', description: 'Run AI models (image gen, etc)' },
      ];

      const installedIds = new Set(loadedSkills.map(s => s.manifest.id));
      const notInstalled = registrySkills.filter(s => !installedIds.has(s.id));

      // Build the system prompt for workflow generation
      const systemPrompt = `You are an expert AI agent designer. Your task is to convert natural language descriptions into structured AI agent workflows.

AVAILABLE SKILLS AND TOOLS (already installed):
${toolDocumentation}

AVAILABLE SKILLS (can be installed from registry):
${notInstalled.map(s => `- ${s.id}: ${s.name} - ${s.description}`).join('\n')}

CRITICAL RULES for workflow steps:
1. For "skill" type steps, you MUST include all required parameters from the tool documentation above
   - Look at the "Parameters: (required)" - these MUST be provided in the "params" object
   - For YouTube skills, if user says "my channel" or "own channel", use "mine" as channel_id
   - Shell commands should be simple and safe (no rm -rf, destructive ops)

2. When creating skill steps:
   - Set "skill" to the skill ID (e.g., "youtube", "data")
   - Set "action" to the tool name (e.g., "get_recent_uploads", "read_json")
   - Include ALL required parameters in the "params" object with actual values, not descriptions

3. Check if existing installed skills can fulfill the need
4. If a needed skill exists in the registry but isn't installed, suggest installing it
5. If no existing or registry skill fits, design a new custom skill with tools/actions

Generate a complete agent configuration with:
1. A clear name for the agent
2. A concise description
3. A workflow with 2-5 logical steps (llm, skill, shell types) with ALL required parameters filled
4. Suggested schedule (if time-based triggers mentioned)
5. Agent memory: role, goals, personality, scratchpad content
6. List of tools/skills that will be needed
7. Skills to install from registry (if any)
8. New custom skills to create (if no existing skill fits)

Respond in JSON format:
{
  "name": "Agent Name",
  "description": "What this agent does",
  "steps": [
    { "name": "Step name", "type": "llm|skill|shell", "prompt"?: "...", "skill"?: "skillId", "action"?: "actionName", "params"?: { "paramName": "value" }, "command"?: "shell command" }
  ],
  "schedule": "cron expression or null",
  "role": "Agent's job title",
  "goals": "Bullet list of goals",
  "personality": "Communication style description",
  "scratchpad": "Reference data and context",
  "suggestedTools": ["tool1", "tool2"],
  "installSkills": ["skill-id-1", "skill-id-2"],
  "createSkills": [
    {
      "id": "custom-skill-id",
      "name": "Skill Name",
      "description": "What this skill does",
      "tools": [
        { "name": "toolName", "description": "What this tool does", "parameters": { "paramName": { "type": "string", "description": "param desc", "required": true } } }
      ]
    }
  ]
}`;

      const client = createClient();
      const model = getModelId();
      
      // Retry logic for flaky generations
      let lastError: Error | null = null;
      let generated: any = null;
      
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await client.chat.completions.create({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Create an agent workflow for: ${description}` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.3, // Lower temp for more consistent results
          });

          const content = response.choices[0]?.message?.content;
          if (!content) {
            throw new Error("No response from AI");
          }

          const parsed = JSON.parse(content);
          
          // Validate required fields
          if (!parsed.name || typeof parsed.name !== 'string') {
            throw new Error("Missing or invalid 'name' field");
          }
          if (!parsed.description || typeof parsed.description !== 'string') {
            throw new Error("Missing or invalid 'description' field");
          }
          if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
            throw new Error("Missing or empty 'steps' array");
          }
          
          // Validate each step has required fields
          for (const step of parsed.steps) {
            if (!step.name || typeof step.name !== 'string') {
              throw new Error("Step missing 'name' field");
            }
            if (!step.type || !['llm', 'skill', 'shell', 'notify', 'parallel'].includes(step.type)) {
              throw new Error(`Step has invalid 'type': ${step.type}`);
            }
            
            // Validate type-specific fields
            if (step.type === 'llm' && !step.prompt) {
              throw new Error(`LLM step "${step.name}" missing 'prompt'`);
            }
            if (step.type === 'skill' && !step.skill) {
              throw new Error(`Skill step "${step.name}" missing 'skill' ID`);
            }
            if (step.type === 'shell' && !step.command) {
              throw new Error(`Shell step "${step.name}" missing 'command'`);
            }
          }
          
          // Valid - use this result
          generated = parsed;
          break;
          
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < 2) {
            console.log(`Workflow generation attempt ${attempt + 1} failed, retrying...`);
            await new Promise(r => setTimeout(r, 500 * (attempt + 1))); // Exponential backoff
          }
        }
      }
      
      if (!generated) {
        throw new Error(`Failed to generate valid workflow after 3 attempts: ${lastError?.message}`);
      }
      
      // Generate YAML from the steps
      const yamlSteps = generated.steps.map((step: any) => {
        const base = `  - name: ${step.name}\n    type: ${step.type}`;
        if (step.type === 'llm' && step.prompt) {
          return `${base}\n    prompt: |\n${step.prompt.split('\n').map((l: string) => `      ${l}`).join('\n')}`;
        }
        if (step.type === 'skill' && step.skill) {
          let skillStep = `${base}\n    skill: ${step.skill}\n    action: ${step.action || 'default'}`;
          // Add params if they exist
          if (step.params && Object.keys(step.params).length > 0) {
            const paramsYaml = Object.entries(step.params)
              .map(([k, v]) => `      ${k}: ${typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : v}`)
              .join('\n');
            skillStep += `\n    params:\n${paramsYaml}`;
          }
          return skillStep;
        }
        if (step.type === 'shell' && step.command) {
          return `${base}\n    command: ${step.command}`;
        }
        return base;
      }).join('\n');

      // Helper to escape YAML strings properly
      const escapeYaml = (str: string): string => {
        if (!str) return '""';
        // If contains special chars, use literal block scalar
        if (str.includes('\n') || str.includes('"') || str.includes('\\')) {
          // Remove trailing newlines and use literal block
          const cleanStr = str.trimEnd();
          return `|\n${cleanStr.split('\n').map(l => `  ${l}`).join('\n')}`;
        }
        // Simple string - just wrap in quotes and escape internal quotes
        return `"${str.replace(/"/g, '\\"')}"`;
      };

      const yaml = [
        `name: ${escapeYaml(generated.name)}`,
        `description: ${escapeYaml(generated.description)}`,
        generated.schedule ? `schedule: ${escapeYaml(generated.schedule)}` : '',
        `steps:`,
        yamlSteps,
      ].filter(Boolean).join('\n') + '\n';

      return c.json({
        ...generated,
        yaml,
      });
    } catch (err: any) {
      console.error("Failed to generate workflow:", err);
      return c.json({ error: err.message || "Failed to generate workflow" }, 500);
    }
  });

  app.patch("/api/agents/:id", async (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    const body = await c.req.json().catch(() => ({})) as {
      enabled?: boolean;
      name?: string;
      description?: string;
      schedule?: string;
      config?: Record<string, unknown>;
    };

    // Update agent in database
    const updates: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') updates.enabled = body.enabled ? 1 : 0;
    if (body.name) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.schedule !== undefined) updates.schedule = body.schedule;
    if (body.config) {
      const currentConfig = JSON.parse(agent.config || "{}");
      updates.config = JSON.stringify({ ...currentConfig, ...body.config });
    }

    // Save updates
    saveAgent({
      ...agent,
      ...updates,
    } as any);

    return c.json({ 
      id: agent.id, 
      ...updates,
      enabled: typeof updates.enabled === 'number' ? !!updates.enabled : agent.enabled,
    });
  });

  app.post("/api/agents/:id/run", async (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    if (!agent.enabled) {
      return c.json({ error: "Agent is disabled. Enable it first." }, 400);
    }

    try {
      // Run the agent (daemon loads workflow from agent record)
      const result = await runAgent(agent.id);
      if (result.success) {
        return c.json({ success: true, message: "Agent run started" });
      } else {
        return c.json({ error: result.error || "Agent run failed" }, 500);
      }
    } catch (err) {
      return c.json({ 
        error: "Failed to start agent run", 
        details: err instanceof Error ? err.message : String(err) 
      }, 500);
    }
  });

  app.delete("/api/agents/:id", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    deleteAgent(agent.id);
    return c.json({ deleted: true });
  });

  // --- Workflow YAML ---
  app.get("/api/agents/:id/workflow", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    if (!agent.workflow_path || !fs.existsSync(agent.workflow_path)) {
      return c.json({ error: "Workflow file not found" }, 404);
    }
    const yaml = fs.readFileSync(agent.workflow_path, "utf-8");
    return c.json({ yaml, path: agent.workflow_path });
  });

  app.put("/api/agents/:id/workflow", async (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    if (!agent.workflow_path) return c.json({ error: "No workflow path configured" }, 400);

    const body = await c.req.json().catch(() => ({}));
    const { yaml: yamlContent } = body as { yaml?: string };
    if (!yamlContent || typeof yamlContent !== "string") {
      return c.json({ error: "yaml field is required" }, 400);
    }

    // Validate YAML parses correctly and has required structure
    let parsed: any;
    try {
      const YAML = await import("yaml");
      parsed = YAML.parse(yamlContent);
    } catch (e) {
      return c.json({ error: `Invalid YAML syntax: ${e instanceof Error ? e.message : String(e)}` }, 400);
    }

    // Support both flat format and nested agent format
    const workflow = parsed.agent || parsed;
    
    // Validate required workflow structure
    if (!workflow.name) {
      return c.json({ error: "Invalid workflow: missing 'name' field" }, 400);
    }
    if (!workflow.steps || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
      return c.json({ error: "Invalid workflow: missing or empty 'steps' array" }, 400);
    }
    
    // Validate each step has required fields
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      if (!step.name) {
        return c.json({ error: `Invalid workflow: step ${i + 1} missing 'name'` }, 400);
      }
      if (!step.type) {
        return c.json({ error: `Invalid workflow: step ${i + 1} (${step.name}) missing 'type'` }, 400);
      }
      
      // Validate type-specific fields
      if (step.type === 'llm' && !step.prompt) {
        return c.json({ error: `Invalid workflow: LLM step "${step.name}" missing 'prompt'` }, 400);
      }
      if (step.type === 'skill' && !step.skill) {
        return c.json({ error: `Invalid workflow: skill step "${step.name}" missing 'skill' ID` }, 400);
      }
      if (step.type === 'shell' && !step.command) {
        return c.json({ error: `Invalid workflow: shell step "${step.name}" missing 'command'` }, 400);
      }
    }

    fs.writeFileSync(agent.workflow_path, yamlContent, "utf-8");
    return c.json({ ok: true });
  });

  // --- Get steps for a specific run ---
  app.get("/api/agents/:id/runs/:runId", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const steps = getSteps(c.req.param("runId"));
    return c.json({
      steps: steps.map((s) => ({
        name: s.step_name,
        index: s.step_index,
        status: s.status,
        output: s.output,
        error: s.error,
        tokensUsed: s.tokens_used,
        startedAt: s.started_at,
        completedAt: s.completed_at,
      })),
    });
  });

  // --- Resume an interrupted run ---
  app.post("/api/agents/:id/resume/:runId", async (c) => {
    const agentId = c.req.param("id");
    const runId = c.req.param("runId");
    
    const agent = getAgent(agentId);
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    // Check if run can be resumed
    const status = getResumeStatus(runId);
    if (!status.canResume) {
      return c.json({ 
        error: "Run cannot be resumed", 
        reason: status.status 
      }, 400);
    }

    try {
      const result = await resumeRun(runId);
      return c.json({
        success: result.success,
        runId: result.runId,
        results: result.results,
        error: result.error,
      });
    } catch (err) {
      return c.json({ 
        error: err instanceof Error ? err.message : String(err) 
      }, 500);
    }
  });

  // --- List interrupted runs for an agent ---
  app.get("/api/agents/:id/interrupted", async (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    const interrupted = await findInterruptedRunsForDisplay({ agentId: agent.id, limit: 10 });
    
    return c.json({
      interruptedRuns: interrupted.map((r: any) => ({
        id: r.id,
        agentId: r.agent_id,
        status: r.status,
        currentStep: r.current_step,
        startedAt: r.started_at,
        checkpointStep: r.checkpoint_step,
        canResume: r.checkpoint_step > 0,
      })),
    });
  });

  // --- Get checkpoint status for a run ---
  app.get("/api/agents/:id/runs/:runId/checkpoint", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    
    const runId = c.req.param("runId");
    const status = getResumeStatus(runId);
    
    return c.json({
      runId,
      canResume: status.canResume,
      status: status.status,
      lastCheckpoint: status.lastCheckpoint ? {
        stepIndex: status.lastCheckpoint.stepIndex,
        createdAt: status.lastCheckpoint.createdAt,
      } : null,
    });
  });

  // --- Agent logs ---
  app.get("/api/agents/:id/logs", (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const limit = parseInt(c.req.query("limit") || "50");
    const logs = getAgentLogs(agent.id, limit);
    return c.json(logs);
  });

  // --- Agent recap ---
  app.get("/api/agents/:id/recap", async (c) => {
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const runs = getLatestRuns(agent.id, 1);
    if (runs.length === 0) return c.json({ error: "No runs" }, 404);
    return c.json({ recap: runs[0].recap || null, run: runs[0] });
  });

  // --- Skills: Install from registry ---
  app.post("/api/skills/install", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { skillId } = body as { skillId?: string };
    
    if (!skillId) {
      return c.json({ error: "skillId is required" }, 400);
    }

    try {
      // Import the skill installer
      const { installSkill } = await import("../../skills/installer.js");
      await installSkill(skillId);
      return c.json({ success: true, skillId });
    } catch (err: any) {
      console.error(`Failed to install skill ${skillId}:`, err);
      return c.json({ error: err.message || "Failed to install skill" }, 500);
    }
  });

  // --- Skills: Create custom skill ---
  app.post("/api/skills/create", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { id, name, description, tools } = body as {
      id?: string;
      name?: string;
      description?: string;
      tools?: Array<{
        name: string;
        description: string;
        parameters?: Record<string, any>;
      }>;
    };
    
    if (!id || !name) {
      return c.json({ error: "id and name are required" }, 400);
    }

    try {
      const skillsDir = path.join(ensureKaiDir(), "skills");
      if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true });
      }

      const skillDir = path.join(skillsDir, id);
      if (fs.existsSync(skillDir)) {
        return c.json({ error: `Skill ${id} already exists` }, 409);
      }

      fs.mkdirSync(skillDir, { recursive: true });

      // Create skill.yaml manifest
      const manifest = {
        id,
        name,
        description: description || `Custom skill: ${name}`,
        version: "1.0.0",
        tools: tools?.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters || {},
        })) || [],
      };

      fs.writeFileSync(
        path.join(skillDir, "skill.yaml"),
        YAML.stringify(manifest)
      );

      // Create basic handler.js template
      const handlerCode = `// Custom skill: ${name}
// Generated by AI agent workflow

export default {
  actions: {
${tools?.map(t => `    // ${t.description}
    ${t.name}: async (params, config) => {
      // Implement your tool logic here
      return \`Executed ${t.name} with: \${JSON.stringify(params)}\`;
    },`).join('\n') || ''}
  }
};
`;

      fs.writeFileSync(path.join(skillDir, "handler.js"), handlerCode);

      return c.json({ 
        success: true, 
        skillId: id, 
        path: skillDir,
        message: `Skill ${name} created. Edit handler.js to implement your logic.`
      });
    } catch (err: any) {
      console.error(`Failed to create skill ${id}:`, err);
      return c.json({ error: err.message || "Failed to create skill" }, 500);
    }
  });

  // --- Notifications ---
  app.get("/api/notifications", (c) => {
    const limit = parseInt(c.req.query("limit") || "30");
    const notifications = listNotifications(limit);
    const unread = unreadNotificationCount();
    return c.json({
      notifications: notifications.map((n) => {
        // Parse attachments - handle both string[] and object[] formats
        let attachments: Array<{ path: string; type: string; name: string }> | undefined;
        if (n.attachments) {
          try {
            const parsed = JSON.parse(n.attachments);
            if (Array.isArray(parsed)) {
              attachments = parsed.map((att: any) => {
                // If it's already an object with path, use it
                if (typeof att === 'object' && att.path) {
                  return {
                    path: att.path,
                    type: att.type || inferAttachmentType(att.path),
                    name: att.name || att.path.split('/').pop() || 'file',
                  };
                }
                // If it's a string (file path), convert to object
                if (typeof att === 'string') {
                  return {
                    path: att,
                    type: inferAttachmentType(att),
                    name: att.split('/').pop() || 'file',
                  };
                }
                return null;
              }).filter(Boolean) as any[];
            }
          } catch {
            // If parsing fails, ignore attachments
          }
        }
        
        return {
          id: n.id,
          agentId: n.agent_id,
          title: n.title,
          message: n.body || '',
          read: !!n.read,
          createdAt: n.created_at,
          attachments,
        };
      }),
      unread,
    });
  });

  app.patch("/api/notifications/:id/read", (c) => {
    const id = parseInt(c.req.param("id"));
    markNotificationRead(id);
    return c.json({ ok: true });
  });

  app.post("/api/notifications/read-all", (c) => {
    markAllNotificationsRead();
    return c.json({ ok: true });
  });

  app.delete("/api/notifications/:id", (c) => {
    const id = parseInt(c.req.param("id"));
    deleteNotification(id);
    return c.json({ ok: true });
  });

  app.delete("/api/notifications", (c) => {
    deleteAllNotifications();
    return c.json({ ok: true });
  });

  // --- Serve notification attachment files ---
  app.get("/api/attachments", (c) => {
    const filePath = c.req.query("path");
    if (!filePath) return c.json({ error: "Missing path" }, 400);

    // Resolve ~ to home directory
    let resolved = filePath.startsWith("~")
      ? path.join(process.env.HOME || "", filePath.slice(1))
      : filePath;
    
    // Resolve relative paths against cwd
    if (!path.isAbsolute(resolved)) {
      resolved = path.resolve(getCwd(), resolved);
    }

    if (!fs.existsSync(resolved)) return c.json({ error: "File not found" }, 404);

    const ext = path.extname(resolved).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
      ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json",
      ".pdf": "application/pdf",
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";
    const data = fs.readFileSync(resolved);
    return new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${path.basename(resolved)}"`,
      },
    });
  });


  // --- Agent Detail Chat (simple request/response) ---
  app.post("/api/agent-chat", async (c) => {
    const body = await c.req.json();
    const { agentId, message } = body as { agentId: string; message: string };
    if (!agentId || !message) return c.json({ error: "Missing agentId or message" }, 400);

    const agent = getAgent(agentId);
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    
    const agentConfig = typeof agent.config === 'string' ? JSON.parse(agent.config || "{}") : (agent.config || {});
    
    let systemPrompt: string;
    if (agentConfig.personality || agentConfig.role) {
      // Build persona from agent config
      const now = new Date().toISOString();
      const persona = {
        id: agent.id,
        name: agent.name,
        role: agentConfig.role || "AI Assistant",
        personality: agentConfig.personality || "",
        goals: agentConfig.goals || "",
        scratchpad: agentConfig.scratchpad || "",
        tools: agentConfig.tools || [],
        maxTurns: agentConfig.maxTurns || 25,
        createdAt: agent.created_at || now,
        updatedAt: agent.updated_at || now,
      };
      const { buildAgentSystemPrompt } = await import("../../agent-persona.js");
      const { getCwd } = await import("../../tools/bash.js");
      systemPrompt = buildAgentSystemPrompt(persona, getCwd());
    } else {
      systemPrompt = `You are ${agent.name}. ${agent.description || ""}\nAnswer questions about your workflows, past runs, and status.`;
    }

    try {
      const client = createClient();
      const response = await client.chat.completions.create({
        model: getModelId(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 4096,
      });

      const text = response.choices[0]?.message?.content
        || (response.choices[0]?.message as any)?.reasoning || "";
      return c.json({ response: text });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  // --- Agent Detail Chat (RESTful) ---
  app.post("/api/agents/:id/chat", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json() as { message: string; attachments?: Array<{type: 'image' | 'file'; name: string; mimeType: string; data: string}> };
    const { message, attachments } = body;
    if (!message) return c.json({ error: "Missing message" }, 400);

    const agent = getAgent(id);
    if (!agent) return c.json({ error: "Agent not found" }, 404);

    // Parse agent config to get personality/goals
    const agentConfig = typeof agent.config === 'string' ? JSON.parse(agent.config || "{}") : (agent.config || {});
    
    // Get available skills for this agent
    const availableSkills = getLoadedSkills();
    const skillDescriptions = availableSkills.map(s => {
      const tools = s.manifest.tools.map(t => `- ${t.name}: ${t.description}`).join('\n  ');
      return `- ${s.manifest.name}: ${s.manifest.description || 'No description'}\n  Tools:\n  ${tools}`;
    }).join('\n\n');
    
    // Build system prompt from config or fallback to simple prompt
    let systemPrompt: string;
    if (agentConfig.personality || agentConfig.goals) {
      systemPrompt = `You are ${agent.name}.

# Your Identity
${agentConfig.personality || "An AI agent helping with tasks."}

# Your Goals
${agentConfig.goals || "Help the user achieve their objectives."}

# Working Notes
${agentConfig.scratchpad || "No notes yet."}

# Current Status
- Enabled: ${agent.enabled ? "Yes" : "No"}
- Schedule: ${agent.schedule || "Not scheduled"}

# Available Skills & Tools
You have access to these skills and can use their tools when needed:

${skillDescriptions || "No skills available."}

You are autonomous. Complete tasks fully without asking for permission. Be concise and direct. Update your working notes with important findings. USE your available skills when appropriate - don't ask the user to do things you can do yourself.`;
    } else {
      // Fallback for agents without personality/goals
      systemPrompt = `You are ${agent.name}. ${agent.description || ""}

You help the user understand your workflow, check your run history, and manage your settings.
Be concise and helpful. If you don't know something, say so.

# Available Skills & Tools
You have access to these skills and can use their tools when needed:

${skillDescriptions || "No skills available."}

Current status: ${agent.enabled ? "Enabled" : "Disabled"}`;
    }

    try {
      const client = createClient();
      
      // Build messages array
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
      ];
      
      // If there are image attachments, add them as content array
      if (attachments && attachments.length > 0) {
        const imageAttachments = attachments.filter(a => a.type === 'image');
        if (imageAttachments.length > 0) {
          const content: any[] = [
            { type: "text", text: message }
          ];
          for (const att of imageAttachments) {
            content.push({
              type: "image_url",
              image_url: { url: `data:${att.mimeType};base64,${att.data}` }
            });
          }
          messages.push({ role: "user", content });
        } else {
          // Non-image attachments just mention them in text
          const filesList = attachments.map(a => a.name).join(', ');
          messages.push({ role: "user", content: `${message}\n\n[Attached files: ${filesList}]` });
        }
      } else {
        messages.push({ role: "user", content: message });
      }
      
      // Set up tools for execution
      const mcpTools = getMcpToolDefinitions();
      const skillTools = getSkillToolDefinitions();
      const activeTools = [...toolDefinitions, ...mcpTools, ...skillTools] as ChatCompletionTool[];
      
      // Tool execution loop (like main chat)
      let turns = 0;
      let finalResponse = "";
      
      while (turns < MAX_TOOL_TURNS) {
        turns++;
        
        const response = await client.chat.completions.create({
          model: getModelId(),
          messages,
          tools: activeTools,
          tool_choice: "auto",
          max_tokens: MAX_TOKENS,
        });
        
        const choice = response.choices[0];
        const assistantMsg = choice?.message;
        
        if (!assistantMsg) break;
        
        // Add assistant message to history
        messages.push(assistantMsg);
        
        // Check if there are tool calls
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
          // Execute each tool call
          for (const toolCall of assistantMsg.tool_calls) {
            // Handle both streaming and non-streaming formats
            const func = (toolCall as any).function;
            const toolName = func?.name;
            const toolArgs = func?.arguments || "{}";
            const toolId = toolCall.id || `call-${Date.now()}`;
            
            if (!toolName) continue;
            
            // Execute the tool
            let result: string;
            try {
              const args = JSON.parse(toolArgs);
              result = await executeTool(toolName, args);
            } catch (err: any) {
              result = `Error: ${err?.message || String(err)}`;
            }
            
            // Add tool result to messages
            messages.push({
              role: "tool",
              tool_call_id: toolId,
              content: result,
            });
          }
        } else {
          // No tool calls - we have the final response
          finalResponse = assistantMsg.content || "";
          break;
        }
      }
      
      return c.json({ 
        response: finalResponse || "No response generated", 
        sessionId: generateSessionId() 
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  // --- AI Workflow Generation ---
  app.post("/api/generate-workflow", async (c) => {
    const { systemPrompt, userPrompt } = await c.req.json() as { 
      systemPrompt: string; 
      userPrompt: string;
    };

    if (!systemPrompt || !userPrompt) {
      return c.json({ error: "Missing systemPrompt or userPrompt" }, 400);
    }

    try {
      const client = createClient();
      const response = await client.chat.completions.create({
        model: getModelId(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4096,
      });

      const text = response.choices[0]?.message?.content
        || (response.choices[0]?.message as any)?.reasoning || "";
      
      // Extract YAML from markdown code block if present
      const yamlMatch = text.match(/```yaml\n([\s\S]*?)```/) || 
                        text.match(/```\n([\s\S]*?)```/) ||
                        [null, text];
      const yaml = yamlMatch[1]?.trim() || text.trim();
      
      return c.json({ yaml });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });
}
