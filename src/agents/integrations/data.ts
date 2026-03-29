import fs from "fs";
import path from "path";
import { registerIntegration, type WorkflowContext } from "../workflow.js";

/**
 * File-based Data Integration
 *
 * Enables cross-agent communication via JSON files.
 * Agents write structured data that other agents can read.
 */

function resolvePath(filePath: string): string {
  return filePath.replace(/^~/, process.env.HOME || "~");
}

export function registerDataIntegration(): void {
  registerIntegration({
    name: "data",
    description: "Read/write/append JSON data files for cross-agent communication",
    actions: {
      // Read a JSON file
      read: async (params) => {
        const file = resolvePath(params.file);
        if (!fs.existsSync(file)) return params.default || null;

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

        const data = typeof params.data === "string" ? params.data : JSON.stringify(params.data, null, 2);
        fs.writeFileSync(file, data, "utf-8");
        return { written: file, size: data.length };
      },

      // Append an entry to a JSON array file
      append: async (params) => {
        const file = resolvePath(params.file);
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        let existing: any[] = [];
        if (fs.existsSync(file)) {
          try {
            existing = JSON.parse(fs.readFileSync(file, "utf-8"));
            if (!Array.isArray(existing)) existing = [existing];
          } catch {
            existing = [];
          }
        }

        const entry = {
          ...params.entry,
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
        return files.filter((f: string) => !f.startsWith(".")).map((f: string) => ({
          name: f,
          path: path.join(dir, f),
          size: fs.statSync(path.join(dir, f)).size,
          modified: fs.statSync(path.join(dir, f)).mtime.toISOString(),
        }));
      },
    },
  });
}
