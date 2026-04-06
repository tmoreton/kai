#!/usr/bin/env node

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import chalk from "chalk";
import fs from "fs";
import { startReplInk } from "./repl-ink.js";
import { initMcpServers, shutdownMcpServers, listMcpServers } from "./tools/index.js";
import { loadAllSkills } from "./skills/index.js";

// Load .env from all possible locations — override existing env vars
// so ~/.kai/.env always takes precedence over stale shell exports
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(process.env.HOME || "~", ".kai/.env"), override: true, quiet: true });
config({ path: resolve(__dirname, "../.env"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });

// Ensure ~/.kai/package.json declares ESM so Node doesn't warn about skill
// handler.js files being parsed as CommonJS.
const kaiPkgPath = resolve(process.env.HOME || "~", ".kai/package.json");
if (!fs.existsSync(kaiPkgPath)) {
  fs.writeFileSync(kaiPkgPath, '{"type":"module"}\n', "utf8");
}

const program = new Command();

program
  .name("kai")
  .description("AI coding assistant with persistent memory, background agents, and tool use")
  .version("1.0.0");

// --- Default: Interactive REPL (with optional initial prompt) ---
program
  .argument("[prompt]", "Initial prompt (runs then continues into REPL)")
  .option("-c, --continue [id]", "Continue most recent session, or a specific session by ID")
  .option("-r, --resume [id]", "Resume a session (alias for --continue)")
  .option("-n, --name <name>", "Name for the session")
  .option("-y, --yes", "Auto-approve all tool calls")
  .option("--yolo", "Disable tool turn limits and stopping guards")
  .action(async (promptArg, options) => {
    let pipedInput = "";
    if (!process.stdin.isTTY) {
      pipedInput = await readStdin();
    }

    // Initialize provider (with fallback check), MCP servers, and skills in parallel
    const { initProvider } = await import("./client.js");
    await Promise.allSettled([initProvider(), initMcpServers(), loadAllSkills()]);

    const initialPrompt = [pipedInput, promptArg].filter(Boolean).join("\n\n") || undefined;

    // -c/-r with no value → true (continue most recent), -c/-r <id> → string
    const continueVal = options.continue || options.resume;
    await startReplInk({
      continueSession: continueVal === true,
      resumeSessionId: typeof continueVal === "string" ? continueVal : undefined,
      sessionName: options.name,
      autoApprove: options.yes,
      unleash: options.yolo,
    }, initialPrompt);
  });

// --- Server (Web UI + Agent Daemon + API) ---
program
  .command("start")
  .alias("server")
  .alias("app")
  .alias("ui")
  .description("Build and start Kai — web UI, agent daemon, and API")
  .option("--port <port>", "Port to listen on", "3141")
  .option("--no-ui", "Disable web UI (API + agents only)")
  .option("--no-agents", "Disable agent daemon (UI + API only)")
  .option("--tailscale", "Expose via Tailscale to your tailnet")
  .option("--funnel", "Expose via Tailscale Funnel to the public internet")
  .option("--skip-build", "Skip rebuild step")
  .action(async (options) => {
    if (!options.skipBuild) {
      const { execSync } = await import("child_process");
      const projectRoot = new URL("../", import.meta.url).pathname;
      console.log("  Building web app...");
      execSync("npm run build:web", { cwd: projectRoot, stdio: "inherit" });
      console.log("  Building server...");
      execSync("npm run build:server", { cwd: projectRoot, stdio: "inherit" });
      // Re-exec with --skip-build so Node loads the freshly compiled code
      // instead of using stale cached modules from before the rebuild
      const args = process.argv.slice(2).filter(a => a !== "--skip-build");
      args.push("--skip-build");
      execSync(`node ${projectRoot}dist/index.js ${args.join(" ")}`, {
        cwd: projectRoot,
        stdio: "inherit",
      });
      return;
    }
    const { startServer } = await import("./web/server.js");
    await startServer({
      port: parseInt(options.port),
      ui: options.ui,
      agents: options.agents,
      tailscale: options.tailscale || options.funnel,
      funnel: options.funnel,
    });
  });

// --- Agent commands ---
const agent = program.command("agent").description("Manage background agents");

agent
  .command("create <name> <workflow-file>")
  .description("Create a new agent from a workflow YAML file")
  .option("-s, --schedule <cron>", "Cron schedule (e.g. '0 */6 * * *')")
  .option("--config <json>", "JSON config overrides")
  .option("--heartbeat-condition <cmd>", "Shell command condition for proactive heartbeat")
  .option("--heartbeat-interval <ms>", "Heartbeat check interval in ms (default: 60000)")
  .option("--heartbeat-cooldown <ms>", "Cooldown between triggers in ms (default: 300000)")
  .action(async (name, workflowFile, options) => {
    const { createAgent } = await import("./agents-core/manager.js");
    try {
      let config = options.config ? JSON.parse(options.config) : undefined;

      // Build heartbeat config from CLI flags
      if (options.heartbeatCondition) {
        config = config || {};
        config.heartbeat = {
          enabled: true,
          interval_ms: options.heartbeatInterval ? parseInt(options.heartbeatInterval) : 60000,
          cooldown_ms: options.heartbeatCooldown ? parseInt(options.heartbeatCooldown) : 300000,
          conditions: [
            { type: "shell", check: options.heartbeatCondition },
          ],
        };
      }

      const id = createAgent({
        name,
        workflowFile,
        schedule: options.schedule,
        config,
      });
      console.log(`✓ Agent created: ${id}`);
      console.log(`  Workflow: ${workflowFile}`);
      if (options.schedule) console.log(`  Schedule: ${options.schedule}`);
      console.log(`\n  Run it:     kai agent run ${id}`);
      console.log(`  Start daemon: kai agent daemon`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("list")
  .description("List all registered agents")
  .action(async () => {
    try {
      const { formatAgentList, daemonStatus } = await import("./agents-core/manager.js");
      console.log(daemonStatus());
      console.log(formatAgentList());
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("output <agent-id> [step]")
  .description("Show the output from an agent's latest run")
  .action(async (agentId, step) => {
    try {
      const { formatAgentOutput } = await import("./agents-core/manager.js");
      console.log(formatAgentOutput(agentId, step));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("info <agent-id>")
  .description("Show detailed info about an agent")
  .action(async (agentId) => {
    try {
      const { formatAgentDetail } = await import("./agents-core/manager.js");
      console.log(formatAgentDetail(agentId));
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("run <agent-id>")
  .description("Run an agent immediately")
  .action(async (agentId) => {
    try {
      const { runAgentCommand } = await import("./agents-core/manager.js");
      await runAgentCommand(agentId);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("resume <run-id>")
  .description("Resume an interrupted run from its last checkpoint")
  .action(async (runId) => {
    const chalk = (await import("chalk")).default;
    try {
      const { resumeRun, getResumeStatus } = await import("./agents/index");
      
      // Check if resumable
      const details = getResumeStatus(runId);
      if (!details.canResume) {
        console.log(chalk.red(`  ✗ Cannot resume: ${details.status}`));
        process.exit(1);
      }

      console.log(chalk.cyan(`  Resuming run ${runId}...`));
      console.log(chalk.dim(`  Last checkpoint step: ${details.lastCheckpoint?.stepIndex ?? 0}`));
      console.log();

      const result = await resumeRun(runId);

      if (result.success) {
        console.log(chalk.green(`  ✓ Run resumed and completed successfully`));
      } else {
        console.log(chalk.red(`  ✗ Resume failed: ${result.error}`));
        process.exit(1);
      }
    } catch (err: any) {
      console.error(chalk.red(`  Error: ${err.message}`));
      process.exit(1);
    }
  });

agent
  .command("list-interrupted")
  .alias("interrupted")
  .description("List all interrupted runs that can be resumed")
  .option("-a, --agent <agent-id>", "Filter by agent ID")
  .action(async (options) => {
    const chalk = (await import("chalk")).default;
    try {
      const { findInterruptedRunsForDisplay } = await import("./agents/index");
      
      const interrupted = await findInterruptedRunsForDisplay({ 
        agentId: options.agent,
        limit: 50 
      });

      if (interrupted.length === 0) {
        console.log(chalk.dim("\n  No interrupted runs found.\n"));
        return;
      }

      console.log(chalk.bold(`\n  Interrupted Runs (${interrupted.length}):\n`));

      for (const run of interrupted) {
        console.log(`  ${chalk.cyan(run.id)}`);
        console.log(`    Agent: ${run.agent_id}`);
        console.log(`    Status: ${run.status}`);
        console.log(`    Checkpoint step: ${run.checkpoint_step}`);
        console.log(`    Started: ${run.started_at}`);
        console.log(`    Resume: kai agent resume ${run.id}`);
        console.log();
      }
    } catch (err: any) {
      console.error(chalk.red(`  Error: ${err.message}`));
      process.exit(1);
    }
  });

agent
  .command("delete <agent-id>")
  .description("Delete an agent and its history")
  .action(async (agentId) => {
    try {
      const { deleteAgent } = await import("./agents-core/db.js");
      deleteAgent(agentId);
      console.log(`✓ Agent "${agentId}" deleted`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

agent
  .command("daemon")
  .description("Start the agent daemon (runs scheduled agents)")
  .action(async () => {
    const { startDaemon, writeDaemonPid, isDaemonRunning } = await import("./agents-core/daemon.js");
    if (isDaemonRunning()) {
      console.log("Daemon is already running.");
      process.exit(0);
    }
    writeDaemonPid();
    startDaemon();

    // Keep alive
    process.on("SIGINT", async () => {
      const { stopDaemon, getDaemonPidPath } = await import("./agents-core/daemon.js");
      const { closeDb } = await import("./agents-core/db.js");
      const fs = await import("fs");
      stopDaemon();
      try { fs.unlinkSync(getDaemonPidPath()); } catch {}
      closeDb();
      process.exit(0);
    });
  });

agent
  .command("stop")
  .description("Stop the running daemon")
  .action(async () => {
    const { stopDaemonProcess } = await import("./agents-core/daemon.js");
    if (stopDaemonProcess()) {
      console.log("✓ Daemon stopped");
    } else {
      console.log("Daemon is not running");
    }
  });

agent
  .command("notify")
  .description("Show agent notifications digest")
  .option("-a, --all", "Show all notifications")
  .option("-r, --read", "Mark notifications as read after viewing")
  .action(async (options) => {
    const chalk = (await import("chalk")).default;
    try {
      const { formatNotificationsList, formatNotificationDigest, markAllNotificationsAsRead } = await import("./agents-core/manager.js");
      if (options.all) {
        console.log(formatNotificationsList());
      } else {
        const digest = formatNotificationDigest(24);
        if (digest) {
          console.log(digest);
        } else {
          console.log(chalk.dim("\n  No agent activity in the last 24 hours.\n"));
        }
      }
      if (options.read) {
        console.log(chalk.dim(markAllNotificationsAsRead()));
      }
    } catch (err: any) {
      console.error(chalk.red(`  Error: ${err.message}`));
      process.exit(1);
    }
  });

agent
  .command("trends <agent-id>")
  .description("Show trends from agent run history")
  .argument("[step-name]", "Step name to analyze (defaults to first completed step)")
  .action(async (agentId, stepName) => {
    try {
      const { formatAgentTrends } = await import("./agents-core/manager.js");
      console.log(formatAgentTrends(agentId, stepName));
    } catch (err: any) {
      console.error(chalk.red(`  Error: ${err.message}`));
      process.exit(1);
    }
  });

// --- Self-Improvement Commands ---
// These integrate with the meta-learner, pattern analyzer, and experiment framework

agent
  .command("optimize <agent-id>")
  .description("Analyze and suggest improvements for an agent")
  .option("-w, --window <n>", "Number of runs to analyze", "30")
  .option("-a, --apply", "Auto-apply high-confidence improvements")
  .option("-o, --output <file>", "Save improvement plan to JSON file")
  .action(async (agentId, options) => {
    const chalk = (await import("chalk")).default;
    const fs = await import("fs");
    
    try {
      // Validate agent exists
      const { getAgent } = await import("./agents-core/db.js");
      const agent = getAgent(agentId);
      if (!agent) {
        console.error(chalk.red(`  ✗ Agent "${agentId}" not found`));
        process.exit(1);
      }

      console.log(chalk.cyan(`  Analyzing ${agentId}...`));

      // Try pattern analyzer first (for future integration)
      // Falls back to meta-learner if pattern analyzer isn't available
      let analysis: any;
      try {
        // Dynamic import with type-only check - module may not exist yet
        const patternAnalyzer = await import("./agents/analysis/pattern-analyzer").catch(() => null);
        if (patternAnalyzer && patternAnalyzer.analyzeAgentPerformance) {
          const result = await patternAnalyzer.analyzeAgentPerformance(agentId, { windowHours: parseInt(options.window) });
          // Convert to the format expected by the display code
          analysis = {
            totalRuns: result.summary.totalRuns,
            successRate: result.successRate,
            qualityTrend: result.patterns.find((p: any) => p.id === "quality-score-correlation")?.type || "stable",
            commonErrors: result.commonErrors.map((e: any) => ({
              type: e.type,
              count: e.count,
              percentage: e.percentageOfFailures,
            })),
            recommendations: result.recommendations.map((r: any) => r.title),
          };
          console.log(chalk.green(`  ✓ Pattern analysis complete`));
        } else {
          throw new Error("Pattern analyzer not available");
        }
      } catch (patternErr) {
        // Fallback to meta-learner
        const { analyzeAgent } = await import("./agents/meta-learner");
        analysis = await analyzeAgent(agentId, parseInt(options.window));
        console.log(chalk.dim(`  Using meta-learner (pattern analyzer not available)`));
      }

      // Display results
      console.log(chalk.bold("\n  Analysis Results\n"));
      console.log(`  Total runs analyzed: ${analysis.totalRuns}`);
      console.log(`  Success rate: ${(analysis.successRate * 100).toFixed(1)}%`);
      console.log(`  Quality trend: ${chalk.cyan(analysis.qualityTrend)}`);

      if (analysis.commonErrors?.length > 0) {
        console.log(chalk.yellow("\n  Common errors:"));
        for (const err of analysis.commonErrors.slice(0, 5)) {
          console.log(`    - ${err.error}: ${err.count}x`);
        }
      }

      if (analysis.slowSteps?.length > 0) {
        console.log(chalk.blue("\n  Slowest steps:"));
        for (const step of analysis.slowSteps.slice(0, 5)) {
          console.log(`    - ${step.step}: ${step.avgMs}ms avg`);
        }
      }

      // Display and handle suggestions
      const suggestions = analysis.suggestions || [];
      const highConfidence = suggestions.filter((s: any) => s.confidence >= 0.9);
      const mediumConfidence = suggestions.filter((s: any) => s.confidence >= 0.7 && s.confidence < 0.9);

      if (suggestions.length > 0) {
        console.log(chalk.green("\n  Improvement Suggestions:"));
        for (const s of suggestions) {
          const confidence = Math.round(s.confidence * 100);
          const color = s.confidence >= 0.9 ? chalk.green : s.confidence >= 0.7 ? chalk.yellow : chalk.dim;
          console.log(color(`    ${s.type} on "${s.target}" (${confidence}%)`));
          console.log(chalk.dim(`      ${s.reason}`));
          if (s.patternMatch) {
            console.log(chalk.dim(`      Pattern: ${s.patternMatch}`));
          }
        }
      } else {
        console.log(chalk.dim("\n  No improvements suggested at this time."));
      }

      // Save output if requested
      if (options.output) {
        const outputPath = options.output.endsWith('.json') ? options.output : `${options.output}.json`;
        fs.writeFileSync(outputPath, JSON.stringify(analysis, null, 2));
        console.log(chalk.dim(`\n  Analysis saved to: ${outputPath}`));
      }

      // Apply improvements if requested
      if (options.apply && highConfidence.length > 0) {
        console.log(chalk.cyan(`\n  Applying ${highConfidence.length} high-confidence improvement(s)...`));
        const { applyImprovements } = await import("./agents/meta-learner");
        const result = await applyImprovements(agentId, highConfidence);
        console.log(chalk.green(`  ✓ Applied: ${result.applied}, Notified: ${result.notified}, Logged: ${result.logged}`));
      } else if (options.apply) {
        console.log(chalk.dim(`\n  No high-confidence improvements to apply.`));
      } else if (highConfidence.length > 0) {
        console.log(chalk.dim(`\n  Run with --apply to auto-apply ${highConfidence.length} high-confidence suggestion(s)`));
      }

      console.log();
    } catch (err: any) {
      console.error(chalk.red(`  ✗ Error: ${err.message}`));
      process.exit(1);
    }
  });

agent
  .command("experiments <agent-id>")
  .description("List A/B experiments and variants for an agent")
  .option("-a, --active", "Show only active experiments")
  .option("-v, --verbose", "Show detailed variant information")
  .action(async (agentId, options) => {
    const chalk = (await import("chalk")).default;
    
    try {
      // Validate agent exists
      const { getAgent } = await import("./agents-core/db.js");
      const agent = getAgent(agentId);
      if (!agent) {
        console.error(chalk.red(`  ✗ Agent "${agentId}" not found`));
        process.exit(1);
      }

      // Try experiment framework (future integration)
      // Falls back to workflow variant detection
      let experiments: any[] = [];
      try {
        // Dynamic import with type-only check - module may not exist yet
        const expFramework = await import("./agents/experiments/framework").catch(() => null);
        if (expFramework && expFramework.listExperiments) {
          experiments = expFramework.listExperiments(agentId);
          if (options.active) {
            experiments = experiments.filter((e: any) => e.active);
          }
        } else {
          throw new Error("Experiment framework not available");
        }
      } catch (expErr) {
        // Fallback: scan for workflow variants
        const { listWorkflowVariants } = await import("./agents-core/manager.js");
        experiments = listWorkflowVariants(agentId);
        if (experiments.length === 0) {
          // Check agent config for experiment metadata
          const config = JSON.parse(agent.config || "{}");
          if (config.experiments) {
            experiments = config.experiments;
          }
        }
      }

      if (experiments.length === 0) {
        console.log(chalk.dim(`\n  No experiments found for ${agentId}.`));
        console.log(chalk.dim(`  Create a variant with: kai agent create-variant ${agentId} <name>`));
        console.log();
        return;
      }

      console.log(chalk.bold(`\n  Experiments for ${agent.name} (${agentId})\n`));

      for (const exp of experiments) {
        const statusIcon = exp.active ? chalk.green("●") : chalk.dim("○");
        const statusText = exp.active ? chalk.green("active") : chalk.dim("inactive");
        console.log(`  ${statusIcon} ${chalk.bold(exp.name || exp.variantName || "Unnamed")} ${chalk.dim(`[${statusText}]`)}`);
        
        if (exp.description) {
          console.log(chalk.dim(`    ${exp.description}`));
        }
        
        if (exp.startDate) {
          console.log(chalk.dim(`    Started: ${new Date(exp.startDate).toLocaleDateString()}`));
        }
        
        if (exp.metrics && Object.keys(exp.metrics).length > 0) {
          console.log(chalk.cyan("    Metrics:"));
          for (const [key, value] of Object.entries(exp.metrics)) {
            console.log(chalk.dim(`      ${key}: ${value}`));
          }
        }

        if (options.verbose && exp.variants) {
          console.log(chalk.blue("    Variants:"));
          for (const variant of exp.variants) {
            const control = variant.isControl ? chalk.green(" (control)") : "";
            console.log(chalk.dim(`      - ${variant.name}${control}`));
            if (variant.trafficSplit) {
              console.log(chalk.dim(`        Traffic: ${Math.round(variant.trafficSplit * 100)}%`));
            }
          }
        }

        console.log();
      }

      // Show controls
      console.log(chalk.dim("  Commands:"));
      console.log(chalk.dim(`    kai agent create-variant ${agentId} <name> - Create new variant`));
      if (experiments.some((e: any) => e.active)) {
        console.log(chalk.dim(`    kai agent enable ${agentId} --variant <name> - Switch variant`));
      }
      console.log();
    } catch (err: any) {
      console.error(chalk.red(`  ✗ Error: ${err.message}`));
      process.exit(1);
    }
  });

agent
  .command("create-variant <agent-id> <variant-name>")
  .description("Create a workflow variant (A/B test branch)")
  .option("-d, --description <text>", "Description of the variant")
  .option("-f, --from <base>", "Base variant to copy from (default: current)")
  .option("-c, --changes <json>", "JSON array of step modifications")
  .action(async (agentId, variantName, options) => {
    const chalk = (await import("chalk")).default;
    const fs = await import("fs");
    const path = await import("path");
    
    try {
      // Validate agent exists
      const { getAgent, saveAgent } = await import("./agents-core/db.js");
      const agent = getAgent(agentId);
      if (!agent) {
        console.error(chalk.red(`  ✗ Agent "${agentId}" not found`));
        process.exit(1);
      }

      // Load current workflow
      const { parseWorkflow } = await import("./agents-core/workflow.js");
      const { ensureKaiDir } = await import("./config.js");
      const currentWorkflow = parseWorkflow(agent.workflow_path);

      // Create variant workflow path
      const workflowsDir = path.join(ensureKaiDir(), "workflows");
      const baseName = path.basename(agent.workflow_path, ".yaml");
      const variantPath = path.join(workflowsDir, `${baseName}-${variantName}.yaml`);

      // Load or copy workflow
      let variantWorkflow: any;
      if (options.from) {
        const fromPath = path.join(workflowsDir, `${baseName}-${options.from}.yaml`);
        if (fs.existsSync(fromPath)) {
          variantWorkflow = parseWorkflow(fromPath);
          console.log(chalk.dim(`  Copying from variant: ${options.from}`));
        } else {
          console.log(chalk.yellow(`  Base variant ${options.from} not found, using current workflow`));
          variantWorkflow = JSON.parse(JSON.stringify(currentWorkflow)); // Deep copy
        }
      } else {
        variantWorkflow = JSON.parse(JSON.stringify(currentWorkflow)); // Deep copy
      }

      // Apply changes if provided
      if (options.changes) {
        try {
          const changes = JSON.parse(options.changes);
          for (const change of changes) {
            if (change.stepIndex !== undefined && change.stepIndex < variantWorkflow.steps.length) {
              if (change.prompt) {
                variantWorkflow.steps[change.stepIndex].prompt = change.prompt;
              }
              if (change.params) {
                variantWorkflow.steps[change.stepIndex].params = { 
                  ...variantWorkflow.steps[change.stepIndex].params, 
                  ...change.params 
                };
              }
              if (change.maxTokens) {
                variantWorkflow.steps[change.stepIndex].max_tokens = change.maxTokens;
              }
            }
          }
          console.log(chalk.dim(`  Applied ${changes.length} modification(s)`));
        } catch (parseErr) {
          console.log(chalk.yellow(`  Warning: Could not parse changes JSON`));
        }
      }

      // Update variant metadata
      variantWorkflow.name = `${currentWorkflow.name} (${variantName})`;
      variantWorkflow.description = options.description || `${variantName} variant of ${agent.name}`;
      variantWorkflow.variant = {
        name: variantName,
        baseAgent: agentId,
        createdAt: new Date().toISOString(),
        isControl: false,
      };

      // Write variant workflow
      const YAML = (await import("yaml")).default;
      fs.writeFileSync(variantPath, YAML.stringify(variantWorkflow));

      // Update agent config with experiment metadata
      const config = JSON.parse(agent.config || "{}");
      config.experiments = config.experiments || [];
      config.experiments.push({
        variantName,
        workflowPath: variantPath,
        createdAt: new Date().toISOString(),
        active: true,
        description: variantWorkflow.description,
      });
      
      saveAgent({
        ...agent,
        config: JSON.stringify(config),
      });

      console.log(chalk.green(`\n  ✓ Variant "${variantName}" created`));
      console.log(chalk.dim(`    Workflow: ${variantPath}`));
      console.log(chalk.dim(`    Base: ${agent.workflow_path}`));
      
      if (!options.changes) {
        console.log(chalk.dim(`\n  Edit the workflow to make changes, then run:`));
        console.log(chalk.dim(`    kai agent run ${agentId} --variant ${variantName}`));
      }
      
      console.log();
    } catch (err: any) {
      console.error(chalk.red(`  ✗ Error: ${err.message}`));
      process.exit(1);
    }
  });

// --- Skill commands ---
const skill = program.command("skill").description("Manage modular skills");

skill
  .command("list")
  .description("List installed skills and their tools")
  .action(async () => {
    const chalk = (await import("chalk")).default;
    const { loadAllSkills, getLoadedSkills, skillsDir } = await import("./skills/index.js");
    await loadAllSkills();
    const skills = getLoadedSkills();

    if (skills.length === 0) {
      console.log(chalk.dim("\n  No skills installed."));
      console.log(chalk.dim(`  Install skills to ${skillsDir()}/`));
      console.log(chalk.dim("  Or use: kai skill install <github-url>\n"));
      return;
    }

    console.log(chalk.bold("\n  Installed Skills\n"));
    for (const s of skills) {
      console.log(`  ${chalk.green("●")} ${chalk.bold(s.manifest.name)} ${chalk.dim(`v${s.manifest.version}`)} ${chalk.dim(`[${s.manifest.id}]`)}`);
      if (s.manifest.description) {
        console.log(chalk.dim(`    ${s.manifest.description}`));
      }
      if (s.manifest.tools.length > 0) {
        for (const tool of s.manifest.tools) {
          console.log(chalk.dim(`    - ${tool.name}: ${tool.description || ""}`));
        }
      }
      console.log("");
    }
  });

skill
  .command("install <source>")
  .description("Install a skill from a GitHub URL or local path")
  .action(async (source) => {
    const chalk = (await import("chalk")).default;
    const { installSkill } = await import("./skills/installer.js");
    try {
      const id = await installSkill(source);
      console.log(chalk.green(`\n  ✓ Skill "${id}" installed successfully\n`));
    } catch (err: any) {
      console.error(chalk.red(`  Error: ${err.message}`));
      process.exit(1);
    }
  });

skill
  .command("uninstall <skill-id>")
  .description("Uninstall a skill")
  .action(async (skillId) => {
    const chalk = (await import("chalk")).default;
    const { uninstallSkill } = await import("./skills/installer.js");
    try {
      await uninstallSkill(skillId);
      console.log(chalk.green(`\n  ✓ Skill "${skillId}" uninstalled\n`));
    } catch (err: any) {
      console.error(chalk.red(`  Error: ${err.message}`));
      process.exit(1);
    }
  });

skill
  .command("reload")
  .description("Hot-reload all installed skills")
  .action(async () => {
    const chalk = (await import("chalk")).default;
    const { reloadAllSkills } = await import("./skills/index.js");
    const result = await reloadAllSkills();
    console.log(chalk.green(`\n  ✓ Reloaded ${result.loaded} skills`));
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(chalk.yellow(`  ⚠ ${err}`));
      }
    }
    console.log("");
  });

// --- MCP commands ---
const mcp = program.command("mcp").description("Manage MCP server connections");

mcp
  .command("list")
  .description("List configured MCP servers and their tools")
  .action(async () => {
    const chalk = (await import("chalk")).default;
    await initMcpServers();
    const servers = listMcpServers();

    if (servers.length === 0) {
      console.log(chalk.dim("\n  No MCP servers configured."));
      console.log(chalk.dim("  Add servers in ~/.kai/settings.json under \"mcp.servers\"\n"));
      return;
    }

    console.log(chalk.bold("\n  MCP Servers\n"));
    for (const server of servers) {
      const status = server.ready ? chalk.green("●") : chalk.red("●");
      console.log(`  ${status} ${chalk.bold(server.name)}`);
      if (server.tools.length > 0) {
        for (const tool of server.tools) {
          console.log(chalk.dim(`    - ${tool}`));
        }
      } else {
        console.log(chalk.dim("    (no tools)"));
      }
      console.log("");
    }

    await shutdownMcpServers();
  });

// Graceful shutdown of MCP servers on exit
process.on("exit", () => { shutdownMcpServers().catch(() => {}); });
process.on("SIGINT", () => { shutdownMcpServers().catch(() => {}).finally(() => process.exit(0)); });

// --- Agent V2 commands ---
import { addAgentV2Commands } from "./commands/agent-v2.js";
addAgentV2Commands(program);

program.parse();

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}
