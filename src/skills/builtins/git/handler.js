/**
 * Git Skill Handler - Advanced Git Operations
 * 
 * Provides smart commits, PR workflows, and branch management
 */

import { createRequire } from "module";
import { execSync } from "child_process";

const require = createRequire(process.cwd() + "/package.json");

function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: "utf-8", stdio: "pipe", ...options });
  } catch (e) {
    return e.stdout || e.stderr || e.message;
  }
}

/**
 * Generate a conventional commit message from git diff
 */
function generateCommitMessage(scope) {
  const files = exec("git diff --staged --stat");
  
  const type = detectCommitType(files);
  const scopePart = scope ? `${scope}:` : "";
  const message = generateSimpleMessage(files);
  
  return scopePart ? `${type}(${scope}): ${message}` : `${type}: ${message}`;
}

function detectCommitType(files) {
  if (files.includes("test") || files.includes("spec")) return "test";
  if (files.includes("doc") || files.includes("README")) return "docs";
  if (files.includes("fix") || files.includes("bug")) return "fix";
  if (files.includes("refactor")) return "refactor";
  return "feat";
}

function generateSimpleMessage(files) {
  const lines = files.split("\n").filter(l => l.includes("|") && !l.includes("files changed"));
  
  if (lines.length === 0) return "update";
  if (lines.length === 1) {
    const file = lines[0].split("|")[0].trim();
    return `update ${file}`;
  }
  
  const categories = categorizeFiles(lines);
  if (categories.length === 1) {
    return `update ${categories[0]}`;
  }
  
  return `update ${categories.join(", ")}`;
}

function categorizeFiles(lines) {
  const categories = new Set();
  
  for (const line of lines) {
    const file = line.split("|")[0].trim();
    if (file.startsWith("src/")) categories.add("source code");
    else if (file.startsWith("test/") || file.includes(".test.")) categories.add("tests");
    else if (file.startsWith("docs/") || file.endsWith(".md")) categories.add("docs");
    else if (file.startsWith("config/") || file.endsWith(".json")) categories.add("config");
    else categories.add("files");
  }
  
  return [...categories];
}

function suggestBranchName(description, prefix = "feature/") {
  let slug = (description || "changes")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 40)
    .replace(/-+$/, "");
  
  const timestamp = Date.now().toString(36).slice(-4);
  return `${prefix}${slug}-${timestamp}`;
}

export default {
  actions: {
    git_smart_commit: (params) => {
      const { message, scope, push = false, dry_run = false } = params;
      
      // Check for staged changes
      const hasStaged = exec("git diff --cached --quiet; echo $?").trim() === "1";
      
      if (!hasStaged) {
        const hasUnstaged = exec("git diff --quiet; echo $?").trim() === "1";
        if (hasUnstaged) {
          return { content: "No staged changes. Run 'git add' first, or I can stage all changes." };
        }
        return { content: "No changes to commit." };
      }
      
      const commitMessage = message || generateCommitMessage(scope);
      
      if (dry_run) {
        const status = exec("git diff --staged --stat");
        return { content: `Dry run - would commit:\n\nMessage: ${commitMessage}\n\nFiles:\n${status}` };
      }
      
      // Commit
      const commitResult = exec(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
      
      let output = commitResult || "Commit successful";
      
      if (push) {
        const pushResult = exec("git push");
        output += "\n" + (pushResult || "Push successful");
      }
      
      return { content: output };
    },

    git_pr_create: (params) => {
      const { title, body, base = "main", branch_name, draft = false } = params;
      
      // Check for uncommitted changes
      const status = exec("git status --porcelain");
      if (status.trim()) {
        return { content: "Uncommitted changes detected. Commit them first with git_smart_commit." };
      }
      
      const branch = branch_name || suggestBranchName(title);
      const currentBranch = exec("git branch --show-current").trim();
      
      // Create branch
      exec(`git checkout -b ${branch} ${currentBranch}`);
      
      // Push branch
      const push = exec(`git push -u origin ${branch}`);
      
      // Create PR using gh CLI
      const draftFlag = draft ? "--draft" : "";
      const prBody = body ? `--body "${body.replace(/"/g, '\\"')}"` : "";
      
      const pr = exec(`gh pr create --title "${title.replace(/"/g, '\\"')}" ${prBody} --base ${base} ${draftFlag}`);
      
      return { 
        content: `Branch: ${branch}\nPush: ${push}\nPR: ${pr || "Created"}`,
        branch,
        prUrl: pr.includes("http") ? pr.match(/https:\/\/[^\s]+/)?.[0] : undefined
      };
    },

    git_log_summary: (params) => {
      const { since = "1 week ago", max_entries = 50, format = "summary" } = params;
      
      const log = exec(`git log --since="${since}" --oneline -n ${max_entries}`);
      
      if (!log.trim()) {
        return { content: `No commits found since ${since}` };
      }
      
      const commits = log.trim().split("\n");
      
      if (format === "list") {
        return { content: log };
      }
      
      if (format === "changelog") {
        const entries = commits.map(c => {
          const match = c.match(/^([a-f0-9]+)\s+(.+)$/);
          if (match) {
            return `- ${match[2]} (${match[1].slice(0, 7)})`;
          }
          return `- ${c}`;
        });
        return { content: entries.join("\n") };
      }
      
      // Summary format
      const types = {};
      const scopes = {};
      
      for (const commit of commits) {
        const msg = commit.replace(/^[a-f0-9]+\s+/, "");
        const typeMatch = msg.match(/^(feat|fix|docs|style|refactor|test|chore)(\(.+\))?:/);
        if (typeMatch) {
          types[typeMatch[1]] = (types[typeMatch[1]] || 0) + 1;
          if (typeMatch[2]) {
            const scope = typeMatch[2].slice(1, -1);
            scopes[scope] = (scopes[scope] || 0) + 1;
          }
        }
      }
      
      let summary = `**${commits.length} commits** since ${since}\n\n`;
      
      if (Object.keys(types).length > 0) {
        summary += "**By type:**\n";
        for (const [type, count] of Object.entries(types)) {
          summary += `- ${type}: ${count}\n`;
        }
        summary += "\n";
      }
      
      if (Object.keys(scopes).length > 0) {
        summary += "**By scope:**\n";
        for (const [scope, count] of Object.entries(scopes)) {
          summary += `- ${scope}: ${count}\n`;
        }
      }
      
      summary += "\n**Recent commits:**\n" + commits.slice(0, 5).join("\n");
      
      return { content: summary };
    },

    git_branch_suggest: (params) => {
      const { context, prefix = "feature/", max_length = 50 } = params;
      
      let baseDescription = context;
      
      if (!baseDescription) {
        const files = exec("git diff --name-only").trim().split("\n").filter(Boolean);
        if (files.length > 0) {
          const dirs = files.map(f => f.split("/")[0]).filter(Boolean);
          const dirCounts = {};
          for (const d of dirs) dirCounts[d] = (dirCounts[d] || 0) + 1;
          const topDir = Object.entries(dirCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
          baseDescription = `update-${topDir || "files"}`;
        } else {
          baseDescription = "changes";
        }
      }
      
      const branchName = suggestBranchName(baseDescription, prefix).substring(0, max_length);
      
      return { content: branchName, branchName };
    },

    git_status_detailed: (params) => {
      const { analyze = true } = params;
      
      const status = exec("git status -sb");
      const porcelain = exec("git status --porcelain");
      
      let output = status || "No changes";
      
      if (analyze && porcelain) {
        const lines = porcelain.trim().split("\n");
        const staged = lines.filter(l => l.match(/^[AMDRC]/));
        const unstaged = lines.filter(l => l.match(/^.[MD?]/));
        
        output += "\n\n**Analysis:**\n";
        output += `- ${staged.length} staged file(s)\n`;
        output += `- ${unstaged.length} unstaged file(s)\n`;
        
        if (staged.length > 0) {
          output += "\n**Staged files:**\n";
          for (const f of staged.slice(0, 10)) {
            output += `- ${f.substring(3)}\n`;
          }
        }
        
        if (unstaged.length > 0) {
          output += "\n**Unstaged files:**\n";
          for (const f of unstaged.slice(0, 10)) {
            output += `- ${f.substring(3)}\n`;
          }
        }
      }
      
      return { content: output };
    }
  }
};
