import { Command } from "commander";
import chalk from "chalk";
import {
  createGoal,
  decomposeGoal,
  orchestrateGoal,
  spawnFromTemplate,
  runDurable,
  resumeRun,
  recoverInterruptedRuns,
  analyzeAgent,
  applyImprovements,
  runMetaLearning,
  listTemplates,
  eventBus,
  watchFile,
} from "../agents/index.js";
import { getAgent, listAgents, getRun, getLatestRuns } from "../agents-core/db.js";
import { expandHome } from "../utils.js";

export function addAgentV2Commands(program: Command): void {
  const v2 = program
    .command("agent-v2")
    .description("Kai Agent System v2 commands");

  // Goal commands
  v2.command("goal <description>")
    .description("Create and orchestrate a high-level goal")
    .option("-p, --priority <n>", "Priority (1-5)", "3")
    .action(async (description: string, opts: any) => {
      const priority = parseInt(opts.priority) as 1 | 2 | 3 | 4 | 5;
      console.log(chalk.cyan(`Creating goal: ${description}`));
      
      const goalId = await createGoal(description, priority);
      console.log(chalk.green(`Goal created: ${goalId}`));
      
      console.log(chalk.dim("Decomposing and orchestrating..."));
      await orchestrateGoal(goalId);
      
      console.log(chalk.green("Goal orchestration complete!"));
    });

  v2.command("decompose <goalId>")
    .description("Decompose a goal into sub-goals (without executing)")
    .action(async (goalId: string) => {
      const subGoals = await decomposeGoal(goalId);
      console.log(chalk.green(`Decomposed into ${subGoals.length} sub-goals:`));
      for (const sg of subGoals) {
        console.log(`  - ${sg.id}: ${sg.description} (${sg.agentType})`);
        if (sg.dependencies.length > 0) {
          console.log(`    Depends on: ${sg.dependencies.join(", ")}`);
        }
      }
    });

  // Template commands
  v2.command("templates")
    .description("List available agent templates")
    .action(() => {
      const templates = listTemplates();
      console.log(chalk.bold("\nAvailable Templates:\n"));
      for (const t of templates) {
        console.log(`  ${chalk.cyan(t.id)} - ${t.name}`);
        console.log(`    ${chalk.dim(t.description)}`);
        if (t.requiredEnv?.length) {
          console.log(`    ${chalk.yellow("Requires:")} ${t.requiredEnv.join(", ")}`);
        }
        if (t.defaultTriggers?.length) {
          const triggers = t.defaultTriggers.map(tr => tr.type).join(", ");
          console.log(`    ${chalk.blue("Triggers:")} ${triggers}`);
        }
        console.log();
      }
    });

  v2.command("spawn <template> [name]")
    .description("Spawn a new agent from a template")
    .option("-c, --config <json>", "Config as JSON", "{}")
    .option("--one-time", "Don't register triggers (run once)")
    .action(async (templateId: string, name: string | undefined, opts: any) => {
      const config = JSON.parse(opts.config);
      if (name) config.name = name;
      
      console.log(chalk.cyan(`Spawning agent from template: ${templateId}`));
      
      const agentId = await spawnFromTemplate(templateId, config, {
        oneTime: opts.oneTime,
      });
      
      console.log(chalk.green(`Agent spawned: ${agentId}`));
    });

  // Durable execution commands
  v2.command("run <agentId>")
    .description("Run an agent with durable execution")
    .option("--resume <runId>", "Resume from a previous run")
    .action(async (agentId: string, opts: any) => {
      console.log(chalk.cyan(`Running agent: ${agentId}`));
      
      const result = await runDurable(agentId, {
        resumeFrom: opts.resume,
      });
      
      if (result.success) {
        console.log(chalk.green(`✓ Run complete: ${result.runId}`));
      } else {
        console.log(chalk.red(`✗ Run failed: ${result.error}`));
      }
    });

  v2.command("resume <runId>")
    .description("Resume an interrupted run from its last checkpoint")
    .action(async (runId: string) => {
      console.log(chalk.cyan(`Resuming run: ${runId}`));
      
      const result = await resumeRun(runId);
      
      if (result.success) {
        console.log(chalk.green(`✓ Resumed and completed: ${result.runId}`));
      } else {
        console.log(chalk.red(`✗ Resume failed: ${result.error}`));
      }
    });

  v2.command("recover")
    .description("Recover all interrupted runs from previous session")
    .action(async () => {
      console.log(chalk.cyan("Recovering interrupted runs..."));
      
      const recovered = await recoverInterruptedRuns();
      
      if (recovered.length > 0) {
        console.log(chalk.green(`✓ Recovered ${recovered.length} run(s):`));
        for (const id of recovered) {
          console.log(`  - ${id}`);
        }
      } else {
        console.log(chalk.dim("No interrupted runs found"));
      }
    });

  // Meta-learning commands
  v2.command("analyze <agentId>")
    .description("Analyze an agent's run history")
    .option("-w, --window <n>", "Number of runs to analyze", "30")
    .action(async (agentId: string, opts: any) => {
      const window = parseInt(opts.window);
      
      console.log(chalk.cyan(`Analyzing ${agentId} (last ${window} runs)...`));
      
      const analysis = await analyzeAgent(agentId, window);
      
      console.log(chalk.bold("\nAnalysis Results:\n"));
      console.log(`  Total runs: ${analysis.totalRuns}`);
      console.log(`  Success rate: ${(analysis.successRate * 100).toFixed(1)}%`);
      console.log(`  Quality trend: ${analysis.qualityTrend}`);
      
      if (analysis.commonErrors.length > 0) {
        console.log(chalk.yellow("\n  Common errors:"));
        for (const err of analysis.commonErrors.slice(0, 5)) {
          console.log(`    - ${err.error}: ${err.count}x`);
        }
      }
      
      if (analysis.slowSteps.length > 0) {
        console.log(chalk.blue("\n  Slowest steps:"));
        for (const step of analysis.slowSteps.slice(0, 5)) {
          console.log(`    - ${step.step}: ${step.avgMs}ms avg`);
        }
      }
      
      if (analysis.suggestions.length > 0) {
        console.log(chalk.green("\n  Suggestions:"));
        for (const s of analysis.suggestions) {
          const confidence = Math.round(s.confidence * 100);
          console.log(`    - ${s.type} on ${s.target} (${confidence}%)`);
          console.log(`      ${s.reason}`);
        }
      }
    });

  v2.command("improve <agentId>")
    .description("Apply suggested improvements to an agent")
    .action(async (agentId: string) => {
      console.log(chalk.cyan(`Analyzing and improving ${agentId}...`));
      
      const analysis = await analyzeAgent(agentId);
      
      if (analysis.suggestions.length === 0) {
        console.log(chalk.dim("No improvements suggested"));
        return;
      }
      
      console.log(`Found ${analysis.suggestions.length} suggestion(s)`);
      
      const result = await applyImprovements(agentId, analysis.suggestions);
      
      console.log(chalk.green(`\nResults:`));
      console.log(`  Applied: ${result.applied}`);
      console.log(`  Notified: ${result.notified}`);
      console.log(`  Logged: ${result.logged}`);
    });

  v2.command("meta-learn")
    .description("Run meta-learning on all agents (daily task)")
    .action(async () => {
      console.log(chalk.cyan("Running meta-learning on all agents..."));
      await runMetaLearning();
      console.log(chalk.green("Complete!"));
    });

  // Test commands
  v2.command("watch <file>")
    .description("Watch a file and show events (test file watcher)")
    .action(async (filePath: string) => {
      const resolved = expandHome(filePath);
      console.log(chalk.cyan(`Watching: ${resolved}`));
      console.log(chalk.dim("Touch the file to see events (Ctrl+C to stop)"));
      
      const unsub = eventBus.subscribe("file:changed", (e) => {
        console.log(chalk.green(`\nEvent: ${e.type}`));
        console.log(`  Path: ${e.payload.path}`);
        console.log(`  Time: ${new Date(e.timestamp).toISOString()}`);
      });
      
      watchFile(filePath);
      
      // Keep alive
      process.on("SIGINT", () => {
        unsub();
        process.exit(0);
      });
      
      setInterval(() => {}, 1000);
    });
}
