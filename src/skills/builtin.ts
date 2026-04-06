import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { skillsDir } from "./loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface BuiltinSkill {
  id: string;
  name: string;
  description: string;
  sourceDir: string;
  targetPrefix: string;
}

interface SkillsConfig {
  skills: BuiltinSkill[];
  settings: {
    autoBootstrap: boolean;
    skipIfExists: boolean;
    requireSkillYaml: boolean;
  };
}

function loadSkillsConfig(): SkillsConfig {
  const configPath = path.join(process.cwd(), "config", "builtin-skills.json");
  const defaultConfig: SkillsConfig = {
    skills: [],
    settings: { autoBootstrap: false, skipIfExists: true, requireSkillYaml: true }
  };
  
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch {
    console.warn("[skills] Could not load builtin-skills.json, using defaults");
  }
  
  return defaultConfig;
}

export function bootstrapBuiltinSkills(): void {
  const config = loadSkillsConfig();
  
  if (!config.settings.autoBootstrap) {
    console.log("[skills] Auto-bootstrap disabled in config");
    return;
  }

  const targetDir = skillsDir();
  const builtinsDir = path.join(__dirname, "builtins");

  if (!fs.existsSync(builtinsDir)) {
    console.warn(`[skills] Builtins directory not found: ${builtinsDir}`);
    return;
  }

  let installed = 0;
  let skipped = 0;

  for (const skill of config.skills) {
    const sourcePath = path.join(builtinsDir, skill.sourceDir);
    const targetPath = path.join(targetDir, `${skill.targetPrefix}${skill.id}`);

    // Skip if already installed
    if (fs.existsSync(targetPath)) {
      skipped++;
      continue;
    }

    // Skip if source doesn't exist
    if (!fs.existsSync(sourcePath)) {
      console.warn(`[skills] Source not found: ${sourcePath}`);
      continue;
    }

    // Skip if skill.yaml required but missing
    if (config.settings.requireSkillYaml && !fs.existsSync(path.join(sourcePath, "skill.yaml"))) {
      console.warn(`[skills] Missing skill.yaml in: ${sourcePath}`);
      continue;
    }

    // Copy skill folder
    try {
      fs.cpSync(sourcePath, targetPath, { recursive: true });
      console.log(`[skills] Installed: ${skill.name}`);
      installed++;
    } catch (err) {
      console.error(`[skills] Failed to install ${skill.name}:`, err);
    }
  }

  const total = installed + skipped;
  if (total > 0) {
    // console.log(`${total} Skills loaded`);
  }
}
