import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { skillsDir } from "./loader.js";

/**
 * Bootstrap Built-in Skills
 *
 * Copies built-in skill folders from dist/skills/builtins/ to ~/.kai/skills/
 * if they don't already exist. This ensures built-in skills are available
 * without manual installation.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Built-in skill directories (relative to this file's location in dist/)
const BUILTIN_SKILLS = ["browser"];

export function bootstrapBuiltinSkills(): void {
  const targetDir = skillsDir();
  const builtinsDir = path.join(__dirname, "builtins");

  if (!fs.existsSync(builtinsDir)) return;

  for (const skillName of BUILTIN_SKILLS) {
    const sourcePath = path.join(builtinsDir, skillName);
    const targetPath = path.join(targetDir, `builtin-${skillName}`);

    // Skip if already installed
    if (fs.existsSync(targetPath)) continue;

    // Skip if source doesn't exist
    if (!fs.existsSync(sourcePath) || !fs.existsSync(path.join(sourcePath, "skill.yaml"))) continue;

    // Copy skill folder
    fs.cpSync(sourcePath, targetPath, { recursive: true });
  }
}
