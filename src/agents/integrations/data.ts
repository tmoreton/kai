import fs from "fs";
import path from "path";
import { registerIntegration, type WorkflowContext } from "../workflow.js";
import { expandHome } from "../../utils.js";

/**
 * ⚠️ DEPRECATED: This integration system is deprecated and will be removed in a future version.
 *
 * MIGRATION GUIDE:
 * The new Skill system should be used instead of direct integrations. Skills provide:
 * - Better type safety and validation
 * - More flexible configuration
 * - Easier testing and mocking
 * - Standardized manifest-based approach
 *
 * To migrate from data integration to skills:
 * 1. Create a skill manifest in ~/.kai/skills/your-skill/skill.yaml
 * 2. Define tools that handle file operations
 * 3. Use `type: skill` and `skill: your-skill` in workflows instead of `type: integration` and `integration: data`
 *
 * Example skill.yaml:
 *   id: data
 *   name: Data Operations
 *   version: 1.0.0
 *   tools:
 *     - name: read
 *       description: Read a JSON file
 *       parameters:
 *         - name: file
 *           type: string
 *           required: true
 *
 * For more information, see the skills/ directory for built-in skill examples.
 *
 * @deprecated Use the skill system instead
 */

/**
 * File-based Data Integration
 *
 * Enables cross-agent communication via JSON files.
 * Agents write structured data that other agents can read.
 */

const resolvePath = expandHome;

/**
 * Normalize an entry that might be a JSON string from LLM output into an object.
 */
function normalizeEntry(entry: any): any {
  if (typeof entry === "string") {
    // Try to parse JSON strings (common from LLM output)
    const trimmed = entry.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { return JSON.parse(trimmed); } catch {}
    }
    // Extract JSON from markdown code blocks
    const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1].trim()); } catch {}
    }
    // Return as-is if not parseable
    return { content: entry };
  }
  return entry;
}

export function registerDataIntegration(): void {
  registerIntegration({
    name: "data",
    description: "Read/write/append/archive JSON data files for cross-agent communication",
    actions: {
      // Read a JSON file
      read: async (params) => {
        const file = resolvePath(params.file);
        if (!fs.existsSync(file)) return params.default ?? null;

        const content = fs.readFileSync(file, "utf-8");
        try {
          return JSON.parse(content);
        } catch {
          return content;
        }
      },

      // Write a JSON file (overwrite)
      write: async (params) => {
        const file = resolvePath(params.file);
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // Normalize: if data is a JSON string, parse it first for clean formatting
        let data = params.data;
        if (typeof data === "string") {
          try { data = JSON.parse(data); } catch {}
        }

        const output = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        fs.writeFileSync(file, output, "utf-8");
        return { written: file, size: output.length };
      },

      // Append an entry to a JSON array file
      append: async (params) => {
        const file = resolvePath(params.file);
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        let existing: any[] = [];
        if (fs.existsSync(file)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
            existing = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            existing = [];
          }
        }

        // Normalize entry — handle JSON strings from LLM, raw objects, etc.
        const normalized = normalizeEntry(params.entry);
        const entry = {
          ...(typeof normalized === "object" && normalized !== null ? normalized : { value: normalized }),
          _timestamp: new Date().toISOString(),
        };
        existing.push(entry);

        // Keep max entries (default 200)
        const max = params.max_entries || 200;
        if (existing.length > max) {
          existing = existing.slice(-max);
        }

        fs.writeFileSync(file, JSON.stringify(existing, null, 2), "utf-8");
        return { appended: file, total_entries: existing.length };
      },

      // Archive a file with timestamp before overwriting (preserves history)
      archive: async (params) => {
        const file = resolvePath(params.file);
        if (!fs.existsSync(file)) return { archived: false, reason: "file does not exist" };

        const archiveDir = resolvePath(params.archive_dir || "~/.kai/archives");
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

        const basename = path.basename(file, path.extname(file));
        const ext = path.extname(file);
        const date = new Date().toISOString().split("T")[0];
        const archivePath = path.join(archiveDir, `${basename}_${date}${ext}`);

        // Don't overwrite same-day archive
        if (!fs.existsSync(archivePath)) {
          fs.copyFileSync(file, archivePath);
        }

        return { archived: true, path: archivePath };
      },

      // Read a text file (SRT, transcript, etc.)
      read_text: async (params) => {
        const file = resolvePath(params.file);
        if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
        return fs.readFileSync(file, "utf-8");
      },

      // List files in a directory
      list_files: async (params) => {
        const dir = resolvePath(params.dir);
        if (!fs.existsSync(dir)) return [];
        const files = fs.readdirSync(dir);
        return files.filter((f: string) => !f.startsWith(".")).map((f: string) => {
          const fullPath = path.join(dir, f);
          const stat = fs.statSync(fullPath);
          return {
            name: f,
            path: fullPath,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            is_dir: stat.isDirectory(),
          };
        });
      },
    },
  });
}
