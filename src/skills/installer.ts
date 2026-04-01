import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { skillsDir, loadSkill, unloadSkill } from "./loader.js";

/**
 * Skill Installer
 *
 * Installs skills from GitHub URLs or local paths into ~/.kai/skills/.
 */

/**
 * Install a skill from a source (GitHub URL or local path).
 * Returns the installed skill ID.
 */
export async function installSkill(source: string): Promise<string> {
  const dir = skillsDir();

  if (source.startsWith("http://") || source.startsWith("https://") || source.startsWith("git@")) {
    // Git clone
    return installFromGit(source, dir);
  } else {
    // Local path — copy
    return installFromLocal(source, dir);
  }
}

/**
 * Clone a git repo into the skills directory.
 */
async function installFromGit(url: string, dir: string): Promise<string> {
  // Extract repo name for the directory
  const repoName = url
    .replace(/\.git$/, "")
    .split("/")
    .pop() || `skill-${Date.now()}`;

  const destPath = path.join(dir, repoName);

  if (fs.existsSync(destPath)) {
    throw new Error(`Skill directory "${repoName}" already exists. Uninstall first or use a different name.`);
  }

  return new Promise((resolve, reject) => {
    exec(`git clone --depth 1 "${url}" "${destPath}"`, { timeout: 60_000 }, async (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`Git clone failed: ${stderr || err.message}`));
        return;
      }

      try {
        const skill = await loadSkill(destPath);
        resolve(skill.manifest.id);
      } catch (loadErr: unknown) {
        // Clean up failed install
        fs.rmSync(destPath, { recursive: true, force: true });
        const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
        reject(new Error(`Skill cloned but failed to load: ${msg}`));
      }
    });
  });
}

/**
 * Copy a local skill directory into ~/.kai/skills/.
 */
async function installFromLocal(sourcePath: string, dir: string): Promise<string> {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Source path not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Source must be a directory containing skill.yaml`);
  }

  const manifestPath = path.join(resolved, "skill.yaml");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No skill.yaml found in ${resolved}`);
  }

  const dirName = path.basename(resolved);
  const destPath = path.join(dir, dirName);

  if (fs.existsSync(destPath)) {
    throw new Error(`Skill directory "${dirName}" already exists. Uninstall first.`);
  }

  // Copy directory
  fs.cpSync(resolved, destPath, { recursive: true });

  try {
    const skill = await loadSkill(destPath);
    return skill.manifest.id;
  } catch (loadErr: unknown) {
    // Clean up failed install
    fs.rmSync(destPath, { recursive: true, force: true });
    const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
    throw new Error(`Skill copied but failed to load: ${msg}`);
  }
}

/**
 * Uninstall a skill by ID.
 * Removes the skill directory from ~/.kai/skills/.
 */
export async function uninstallSkill(skillId: string): Promise<void> {
  await unloadSkill(skillId);

  // Find and remove the directory
  const dir = skillsDir();
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, "skill.yaml");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const YAML = await import("yaml");
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = YAML.parse(raw);
      if (manifest.id === skillId) {
        fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
        return;
      }
    } catch {
      continue;
    }
  }

  throw new Error(`Skill "${skillId}" not found in ${dir}`);
}
