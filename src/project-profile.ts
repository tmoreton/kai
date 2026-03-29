import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { ensureProjectDir, getCurrentProject } from "./project.js";

/**
 * Auto-generated Project Profile
 *
 * Scans the project on first run to detect tech stack, structure, and key files.
 * Stored per-project in ~/.kai/ and auto-loaded into system context.
 * Replaces manual KAI.md — updated automatically as Kai learns.
 */

export interface ProjectProfile {
  name: string;
  path: string;
  techStack: string[];
  packageManager: string;
  language: string;
  framework: string;
  keyFiles: string[];
  structure: string;
  scripts: Record<string, string>;
  notes: string[];
  generatedAt: string;
  updatedAt: string;
}

function profilePath(): string {
  const dir = ensureProjectDir("profile");
  return path.join(dir, "profile.json");
}

export function loadProfile(): ProjectProfile | null {
  const p = profilePath();
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  } catch {}
  return null;
}

export function saveProfile(profile: ProjectProfile): void {
  profile.updatedAt = new Date().toISOString();
  fs.writeFileSync(profilePath(), JSON.stringify(profile, null, 2), "utf-8");
}

/**
 * Add a note to the project profile (called as Kai learns things).
 */
export function addProfileNote(note: string): void {
  const profile = loadProfile();
  if (!profile) return;
  if (!profile.notes.includes(note)) {
    profile.notes.push(note);
    if (profile.notes.length > 20) profile.notes = profile.notes.slice(-20);
    saveProfile(profile);
  }
}

/**
 * Scan the current project and generate a profile.
 */
export function generateProfile(projectPath?: string): ProjectProfile {
  const project = getCurrentProject();
  const root = projectPath || project?.path || process.cwd();
  const name = project?.name || path.basename(root);

  const profile: ProjectProfile = {
    name,
    path: root,
    techStack: [],
    packageManager: "unknown",
    language: "unknown",
    framework: "none",
    keyFiles: [],
    structure: "",
    scripts: {},
    notes: [],
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Detect package manager + language from config files
  const has = (f: string) => fs.existsSync(path.join(root, f));

  if (has("package.json")) {
    profile.techStack.push("Node.js");
    profile.language = "TypeScript/JavaScript";
    profile.packageManager = has("pnpm-lock.yaml") ? "pnpm"
      : has("yarn.lock") ? "yarn"
      : has("bun.lockb") ? "bun"
      : "npm";

    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
      if (pkg.scripts) profile.scripts = pkg.scripts;
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Detect framework
      if (allDeps["next"]) { profile.framework = "Next.js"; profile.techStack.push("Next.js"); }
      else if (allDeps["nuxt"]) { profile.framework = "Nuxt"; profile.techStack.push("Nuxt"); }
      else if (allDeps["react"]) { profile.framework = "React"; profile.techStack.push("React"); }
      else if (allDeps["vue"]) { profile.framework = "Vue"; profile.techStack.push("Vue"); }
      else if (allDeps["svelte"]) { profile.framework = "Svelte"; profile.techStack.push("Svelte"); }
      else if (allDeps["express"]) { profile.framework = "Express"; profile.techStack.push("Express"); }
      else if (allDeps["fastify"]) { profile.framework = "Fastify"; profile.techStack.push("Fastify"); }
      else if (allDeps["hono"]) { profile.framework = "Hono"; profile.techStack.push("Hono"); }

      if (allDeps["typescript"] || has("tsconfig.json")) {
        profile.language = "TypeScript";
        profile.techStack.push("TypeScript");
      }
      if (allDeps["tailwindcss"]) profile.techStack.push("Tailwind CSS");
      if (allDeps["prisma"] || allDeps["@prisma/client"]) profile.techStack.push("Prisma");
      if (allDeps["drizzle-orm"]) profile.techStack.push("Drizzle");
      if (allDeps["better-sqlite3"] || allDeps["sqlite3"]) profile.techStack.push("SQLite");
      if (allDeps["pg"] || allDeps["postgres"]) profile.techStack.push("PostgreSQL");
      if (allDeps["vitest"]) profile.techStack.push("Vitest");
      else if (allDeps["jest"]) profile.techStack.push("Jest");
    } catch {}
  }

  if (has("Cargo.toml")) {
    profile.language = "Rust";
    profile.techStack.push("Rust");
    profile.packageManager = "cargo";
  }
  if (has("go.mod")) {
    profile.language = "Go";
    profile.techStack.push("Go");
    profile.packageManager = "go mod";
  }
  if (has("pyproject.toml") || has("requirements.txt")) {
    profile.language = "Python";
    profile.techStack.push("Python");
    profile.packageManager = has("pyproject.toml") ? "uv/pip" : "pip";
    if (has("pyproject.toml")) {
      try {
        const pyproject = fs.readFileSync(path.join(root, "pyproject.toml"), "utf-8");
        if (pyproject.includes("django")) profile.techStack.push("Django");
        if (pyproject.includes("fastapi")) profile.techStack.push("FastAPI");
        if (pyproject.includes("flask")) profile.techStack.push("Flask");
      } catch {}
    }
  }

  // Detect key files
  const keyFilePatterns = [
    "README.md", "package.json", "tsconfig.json", "Cargo.toml", "go.mod",
    "pyproject.toml", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    ".env.example", "Makefile", ".github/workflows",
  ];
  for (const f of keyFilePatterns) {
    if (has(f)) profile.keyFiles.push(f);
  }

  // Generate structure (top-level dirs + key nested dirs)
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !["node_modules", "dist", "build", "__pycache__", "target", ".next", "vendor"].includes(e.name))
      .map((e) => e.name);
    const files = entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name)
      .slice(0, 10);

    profile.structure = [
      ...dirs.map((d) => `${d}/`),
      ...files,
    ].join(", ");
  } catch {}

  // Git info
  try {
    const branch = execSync("git branch --show-current", { cwd: root, encoding: "utf-8", stdio: "pipe" }).trim();
    if (branch) profile.techStack.push("Git");
  } catch {}

  saveProfile(profile);
  return profile;
}

/**
 * Get or generate the project profile. Auto-generates on first access.
 */
export function getOrGenerateProfile(): ProjectProfile | null {
  const project = getCurrentProject();
  if (!project) return null;

  const existing = loadProfile();
  if (existing) return existing;

  return generateProfile();
}

/**
 * Format the profile for injection into the system prompt context.
 */
export function getProfileContext(): string {
  const profile = getOrGenerateProfile();
  if (!profile) return "";

  const parts = [
    `# Project: ${profile.name}`,
    `- Path: ${profile.path}`,
    `- Language: ${profile.language}`,
    `- Stack: ${profile.techStack.join(", ")}`,
  ];

  if (profile.framework !== "none") parts.push(`- Framework: ${profile.framework}`);
  if (profile.packageManager !== "unknown") parts.push(`- Package manager: ${profile.packageManager}`);
  if (profile.structure) parts.push(`- Structure: ${profile.structure}`);

  if (Object.keys(profile.scripts).length > 0) {
    const scriptList = Object.entries(profile.scripts)
      .slice(0, 8)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");
    parts.push(`- Scripts:\n${scriptList}`);
  }

  if (profile.notes.length > 0) {
    parts.push(`- Notes:\n${profile.notes.map((n) => `  - ${n}`).join("\n")}`);
  }

  return parts.join("\n");
}
