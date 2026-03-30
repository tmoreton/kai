import type { Command } from "commander";

/**
 * YouTube Content Pipeline CLI Commands
 *
 * Registers: kai yt idea|process|produce|board|status
 */
export function registerYouTubeCommands(program: Command): void {
  const yt = program.command("yt").description("YouTube content pipeline");

  yt.command("idea <text...>")
    .description("Submit a video idea for expansion and analysis")
    .action(async (textParts: string[]) => {
      const idea = textParts.join(" ");
      const fs = await import("fs");
      const path = await import("path");
      const home = process.env.HOME || "~";
      const outputDir = path.join(home, ".kai/youtube/productions", `idea-${Date.now()}`);
      fs.mkdirSync(outputDir, { recursive: true });

      const config = {
        mode: "idea",
        input: idea,
        output_dir: outputDir,
      };

      console.log(`\n  Processing idea: "${idea}"\n`);
      console.log(`  Output: ${outputDir}\n`);

      const { registerAllIntegrations } = await import("./agents/integrations/index.js");
      const { parseWorkflow, executeWorkflow } = await import("./agents/workflow.js");
      const { ensureAgent } = await import("./agents/db.js");
      await registerAllIntegrations();

      const workflowPath = path.join(home, ".kai/workflows/yt-inbox.yaml");
      if (!fs.existsSync(workflowPath)) {
        console.error("  Error: yt-inbox.yaml workflow not found. Run: kai agent create yt-inbox ~/.kai/workflows/yt-inbox.yaml");
        process.exit(1);
      }

      ensureAgent("yt-inbox", "YouTube Inbox", workflowPath);
      const workflow = parseWorkflow(workflowPath);
      const result = await executeWorkflow(workflow, "yt-inbox", config, (step, status) => {
        console.log(`    ${step}: ${status}`);
      });

      if (result.success) {
        console.log("\n  Done! Check output:\n");
        console.log(`    ${outputDir}/output.json`);
        if (result.results.thumbnail) {
          console.log(`    Thumbnail: ${JSON.stringify(result.results.thumbnail)}`);
        }
      } else {
        console.log(`\n  Failed: ${result.error}`);
      }
    });

  yt.command("process <file>")
    .description("Process an SRT/transcript file into a full production package")
    .action(async (file: string) => {
      const fs = await import("fs");
      const path = await import("path");
      const home = process.env.HOME || "~";

      const filePath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
      if (!fs.existsSync(filePath)) {
        console.error(`  Error: File not found: ${filePath}`);
        process.exit(1);
      }

      const transcript = fs.readFileSync(filePath, "utf-8");
      const slug = path.basename(file, path.extname(file)).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const outputDir = path.join(home, `.kai/youtube/productions/${slug}-${Date.now()}`);
      fs.mkdirSync(outputDir, { recursive: true });

      const config = {
        mode: "transcript",
        input: transcript,
        output_dir: outputDir,
      };

      console.log(`\n  Processing transcript: ${path.basename(file)}\n`);
      console.log(`  Output: ${outputDir}\n`);

      const { registerAllIntegrations } = await import("./agents/integrations/index.js");
      const { parseWorkflow, executeWorkflow } = await import("./agents/workflow.js");
      const { ensureAgent } = await import("./agents/db.js");
      await registerAllIntegrations();

      const workflowPath = path.join(home, ".kai/workflows/yt-inbox.yaml");
      if (!fs.existsSync(workflowPath)) {
        console.error("  Error: yt-inbox.yaml workflow not found.");
        process.exit(1);
      }

      ensureAgent("yt-inbox", "YouTube Inbox", workflowPath);
      const workflow = parseWorkflow(workflowPath);
      const result = await executeWorkflow(workflow, "yt-inbox", config, (step, status) => {
        console.log(`    ${step}: ${status}`);
      });

      if (result.success) {
        console.log("\n  Done! Check output:\n");
        console.log(`    ${outputDir}/output.json`);
        console.log("\n  Includes: clean script, edit guide, titles, SEO, shorts clips, thumbnail\n");
      } else {
        console.log(`\n  Failed: ${result.error}`);
      }
    });

  yt.command("produce [idea]")
    .description("Trigger the Producer - optionally specify an idea to produce")
    .action(async (idea?: string) => {
      const fs = await import("fs");
      const path = await import("path");
      const home = process.env.HOME || "~";

      if (idea) {
        const manualPath = path.join(home, ".kai/youtube/data/manual-produce.json");
        const dir = path.dirname(manualPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(manualPath, JSON.stringify({
          idea,
          submitted_at: new Date().toISOString(),
        }, null, 2), "utf-8");
        console.log(`\n  Queued manual idea: "${idea}"\n`);
      }

      console.log("  Running Producer agent...\n");

      const { registerAllIntegrations } = await import("./agents/integrations/index.js");
      const { parseWorkflow, executeWorkflow } = await import("./agents/workflow.js");
      const { ensureAgent } = await import("./agents/db.js");
      await registerAllIntegrations();

      ensureAgent("yt-producer", "YouTube Producer");
      const workflowPath = path.join(home, ".kai/workflows/yt-producer.yaml");
      if (!fs.existsSync(workflowPath)) {
        console.error("  Error: yt-producer.yaml not found.");
        process.exit(1);
      }

      const workflow = parseWorkflow(workflowPath);
      const result = await executeWorkflow(workflow, "yt-producer", {}, (step, status) => {
        console.log(`    ${step}: ${status}`);
      });

      if (result.success) {
        console.log("\n  Production package ready!\n");
        console.log(`    ~/.kai/youtube/productions/latest.json`);
      } else {
        console.log(`\n  Failed: ${result.error}`);
      }
    });

  yt.command("board")
    .description("Show the current content board")
    .action(async () => {
      const fs = await import("fs");
      const path = await import("path");
      const chalk = (await import("chalk")).default;
      const home = process.env.HOME || "~";
      const boardPath = path.join(home, ".kai/youtube/data/content-board.json");

      if (!fs.existsSync(boardPath)) {
        console.log(chalk.dim("  No content board yet. Run the strategist agent first."));
        return;
      }

      let raw = fs.readFileSync(boardPath, "utf-8");
      let board: any;
      try {
        board = JSON.parse(raw);
      } catch {
        let repaired = raw
          .replace(/[\n\r]+/g, " ")
          .replace(/,\s*([}\]])/g, "$1");
        if (!repaired.trimEnd().endsWith("}")) {
          repaired = repaired.replace(/[^"]*$/, "") + '"}]}';
        }
        try {
          board = JSON.parse(repaired);
        } catch {
          console.log(chalk.yellow("  Content board JSON is corrupted (LLM truncated output)."));
          console.log(chalk.dim("  Re-running strategist to regenerate..."));
          console.log(chalk.dim("  Run: kai agent run agent-yt-strategist\n"));
          return;
        }
      }
      console.log(chalk.bold("\n  Content Board\n"));
      if (board.week_summary) {
        console.log(chalk.dim(`  ${board.week_summary}\n`));
      }
      if (board.updated_at) {
        console.log(chalk.dim(`  Updated: ${board.updated_at}\n`));
      }

      if (board.this_week_picks) {
        console.log(chalk.bold.cyan("  This Week's Picks:"));
        if (board.this_week_picks.long_form?.length) {
          console.log(chalk.bold("    Long-form:"), board.this_week_picks.long_form.join(", "));
        }
        if (board.this_week_picks.short_form?.length) {
          console.log(chalk.bold("    Short-form:"), board.this_week_picks.short_form.join(", "));
        }
        console.log("");
      }

      const ideas = board.ideas || [];
      for (const idea of ideas) {
        const typeIcon = idea.type === "long" ? "L" : "S";
        const urgencyBar = "#".repeat(Math.min(idea.urgency || 0, 10)) + "-".repeat(10 - Math.min(idea.urgency || 0, 10));
        console.log(`  [${typeIcon}] #${idea.rank || "?"} ${chalk.bold(idea.title_options?.[0] || idea.id)}`);
        console.log(chalk.dim(`     ${idea.type} | ${idea.difficulty || "?"} | ~${idea.estimated_views || "?"} views | urgency: ${urgencyBar}`));
        if (idea.hook) console.log(chalk.dim(`     Hook: ${idea.hook.substring(0, 80)}`));
        console.log("");
      }
    });

  yt.command("status")
    .description("Show YouTube pipeline status")
    .action(async () => {
      const fs = await import("fs");
      const path = await import("path");
      const chalk = (await import("chalk")).default;
      const home = process.env.HOME || "~";

      console.log(chalk.bold("\n  YouTube Pipeline Status\n"));

      // Intel feed
      const intelPath = path.join(home, ".kai/youtube/data/intel.json");
      if (fs.existsSync(intelPath)) {
        const intel = JSON.parse(fs.readFileSync(intelPath, "utf-8"));
        const entries = Array.isArray(intel) ? intel : [];
        const latest = entries[entries.length - 1];
        console.log(chalk.bold("  Scout Intel:"));
        console.log(chalk.dim(`    ${entries.length} entries collected`));
        if (latest?._timestamp) console.log(chalk.dim(`    Last update: ${latest._timestamp}`));
      } else {
        console.log(chalk.dim("  Scout Intel: no data yet"));
      }
      console.log("");

      // Content board
      const boardPath = path.join(home, ".kai/youtube/data/content-board.json");
      if (fs.existsSync(boardPath)) {
        const board = JSON.parse(fs.readFileSync(boardPath, "utf-8"));
        const ideas = board.ideas || [];
        console.log(chalk.bold("  Content Board:"));
        console.log(chalk.dim(`    ${ideas.filter((i: any) => i.type === "long").length} long-form ideas`));
        console.log(chalk.dim(`    ${ideas.filter((i: any) => i.type === "short").length} short-form ideas`));
        if (board.updated_at) console.log(chalk.dim(`    Last update: ${board.updated_at}`));
      } else {
        console.log(chalk.dim("  Content Board: not created yet"));
      }
      console.log("");

      // Idea backlog
      const backlogPath = path.join(home, ".kai/youtube/data/idea-backlog.json");
      if (fs.existsSync(backlogPath)) {
        const backlog = JSON.parse(fs.readFileSync(backlogPath, "utf-8"));
        const count = Array.isArray(backlog) ? backlog.length : 0;
        console.log(chalk.bold("  Idea Backlog:"));
        console.log(chalk.dim(`    ${count} pending ideas`));
      } else {
        console.log(chalk.dim("  Idea Backlog: empty"));
      }
      console.log("");

      // Productions
      const prodDir = path.join(home, ".kai/youtube/productions");
      if (fs.existsSync(prodDir)) {
        const prods = fs.readdirSync(prodDir).filter((f: string) => !f.startsWith("."));
        console.log(chalk.bold("  Productions:"));
        console.log(chalk.dim(`    ${prods.length} packages created`));
        for (const p of prods.slice(-3)) {
          console.log(chalk.dim(`    - ${p}`));
        }
      }
      console.log("");
    });
}
