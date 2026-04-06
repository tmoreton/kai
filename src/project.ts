import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ensureKaiDir } from "./config.js";
import { saveProject, touchProject, getProjectByPath } from "./db/projects-db.js";

export interface ProjectInfo {
  id: string;
  path: string;
  name: string;
  lastAccessed: string;
}

const PROJECT_MARKERS = [
  ".kai",
  ".git",
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "Makefile",
  ".project",
];

const GLOBAL_PROJECT_ID = "__global__";

let cachedProject: ProjectInfo | null = null;
let projectResolved = false;

/**
 * Generate a stable project ID from an absolute path.
 */
function hashPath(absPath: string): string {
  return crypto.createHash("md5").update(absPath).digest("hex").substring(0, 12);
}

/**
 * Detect the project root by walking up from cwd.
 */
export function resolveProject(cwd?: string): ProjectInfo | null {
  if (projectResolved) return cachedProject;
  projectResolved = true;

  const startDir = path.resolve(cwd || process.cwd());
  let dir = startDir;

  while (true) {
    for (const marker of PROJECT_MARKERS) {
      const markerPath = path.join(dir, marker);
      if (fs.existsSync(markerPath)) {
        const id = hashPath(dir);
        
        // Check if already in DB
        let info = getProjectByPath(dir);
        if (!info) {
          info = {
            id,
            path: dir,
            name: path.basename(dir),
            lastAccessed: new Date().toISOString(),
          };
          saveProject(info);
        } else {
          touchProject(id);
          info.lastAccessed = new Date().toISOString();
        }
        
        cachedProject = info;
        return info;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break; // Hit filesystem root
    dir = parent;
  }

  // No project found — desktop/global mode
  cachedProject = null;
  return null;
}

/**
 * Get the project ID for the current context.
 * Returns "__global__" if no project detected.
 */
export function getProjectId(cwd?: string): string {
  const project = resolveProject(cwd);
  return project?.id || GLOBAL_PROJECT_ID;
}

/**
 * Get the current project info (null in desktop mode).
 */
export function getCurrentProject(): ProjectInfo | null {
  return resolveProject();
}

// --- Legacy JSON registry (for migration) ---

function registryPath(): string {
  return path.join(ensureKaiDir(), "projects.json");
}

function loadRegistry(): Record<string, ProjectInfo> {
  try {
    const p = registryPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  } catch {}
  return {};
}

function saveRegistry(registry: Record<string, ProjectInfo>): void {
  fs.writeFileSync(registryPath(), JSON.stringify(registry, null, 2), "utf-8");
}

function registerProject(info: ProjectInfo): void {
  const registry = loadRegistry();
  registry[info.id] = info;
  saveRegistry(registry);
}

export function listProjects(): ProjectInfo[] {
  const registry = loadRegistry();
  return Object.values(registry).sort(
    (a, b) => (b.lastAccessed || "").localeCompare(a.lastAccessed || "")
  );
}

// --- Scoped Directory Helpers ---

/**
 * Ensure a directory exists under ~/.kai/ scoped to a project.
 * e.g., ensureProjectDir("recall") → ~/.kai/recall/projects/{projectId}/
 */
export function ensureProjectDir(subsystem: string, projectId?: string): string {
  const pid = projectId || getProjectId();
  const dir = path.join(ensureKaiDir(), subsystem, "projects", pid);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Ensure a global directory exists under ~/.kai/.
 * e.g., ensureGlobalDir("archival") → ~/.kai/archival/
 */
export function ensureGlobalDir(subsystem: string): string {
  const dir = path.join(ensureKaiDir(), subsystem);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
