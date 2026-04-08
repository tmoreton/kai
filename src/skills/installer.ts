import fs from "fs";
import path from "path";
import { exec, execSync } from "child_process";
import { skillsDir, loadSkill, unloadSkill } from "./loader.js";

/**
 * Skill Installer
 *
 * Installs skills from GitHub URLs or local paths into ~/.kai/skills/.
 */

/**
 * Compile TypeScript handler to JavaScript if needed
 */
async function compileSkillIfNeeded(skillPath: string): Promise<void> {
  const handlerJsPath = path.join(skillPath, "handler.js");
  const handlerTsPath = path.join(skillPath, "handler.ts");
  
  // If handler.js exists, check if it has TypeScript syntax
  if (fs.existsSync(handlerJsPath)) {
    const content = fs.readFileSync(handlerJsPath, "utf-8");
    const hasTypeScriptSyntax = /\b(interface|type\s+\w|:\s*(string|number|boolean|any)\b|\w+:\s*\w+\s*=>)/.test(content);
    
    if (hasTypeScriptSyntax) {
      // It's actually TypeScript with wrong extension - compile it
      console.log(`  Detected TypeScript in ${handlerJsPath}, compiling...`);
      
      try {
        // Check for tsx first
        execSync("which tsx", { stdio: "pipe" });
        
        // Compile using tsx's esbuild
        execSync(
          `npx tsx "${handlerJsPath}" --eval "console.log('syntax check passed')"`,
          { stdio: "pipe", timeout: 30000 }
        );
        
        // Actually compile it
        const esbuildCode = `
          const esbuild = require('esbuild');
          esbuild.build({
            entryPoints: ['${handlerJsPath}'],
            outfile: '${handlerJsPath}',
            format: 'esm',
            target: 'node18',
            platform: 'node',
          }).then(() => console.log('compiled')).catch(e => { console.error(e); process.exit(1); });
        `;
        
        execSync(`node -e "${esbuildCode}"`, { stdio: "pipe", timeout: 30000 });
      } catch {
        // Fallback: rename and use ts-node style
        fs.renameSync(handlerJsPath, handlerTsPath);
        
        // Create a loader wrapper
        const wrapperCode = `import { tsxImport } from 'tsx/dist/loader.mjs'; export default await tsxImport('./handler.ts', import.meta.url);`;
        fs.writeFileSync(handlerJsPath, wrapperCode, "utf-8");
      }
    }
  }
  
  // If only handler.ts exists, compile it
  if (!fs.existsSync(handlerJsPath) && fs.existsSync(handlerTsPath)) {
    console.log(`  Compiling TypeScript handler...`);
    
    try {
      // Try using tsc if available
      execSync(
        `npx tsc "${handlerTsPath}" --outDir "${skillPath}" --module esnext --moduleResolution node --esModuleInterop --target es2022 --skipLibCheck --declaration false`,
        { stdio: "pipe", timeout: 60000 }
      );
    } catch {
      throw new Error(
        `Skill has TypeScript handler (handler.ts) but compilation failed. ` +
        `Please ensure the skill includes a compiled handler.js file, ` +
        `or install TypeScript globally: npm install -g typescript`
      );
    }
  }
}

/**
 * Install a skill from a source (GitHub URL or local path).
 * Supports installing individual skills from the kai-skills monorepo.
 * Returns the installed skill ID.
 */
export async function installSkill(source: string): Promise<string> {
  const dir = skillsDir();

  // Check if this is a kai-skills built-in skill reference
  const kaiSkillsMatch = source.match(/^kai[-:]?(.+)$/i);
  if (kaiSkillsMatch) {
    const skillId = kaiSkillsMatch[1];
    return installKaiSkill(skillId, dir);
  }

  if (source.startsWith("http://") || source.startsWith("https://") || source.startsWith("git@")) {
    // Git clone
    return installFromGit(source, dir);
  } else {
    // Local path — copy
    return installFromLocal(source, dir);
  }
}

/**
 * Install a built-in skill from the kai-skills repository.
 * Clones the repo temporarily and copies just the specific skill.
 */
async function installKaiSkill(skillId: string, dir: string): Promise<string> {
  const destPath = path.join(dir, skillId);
  
  if (fs.existsSync(destPath)) {
    throw new Error(`Skill "${skillId}" is already installed.`);
  }

  // Create temp directory for cloning
  const tempDir = path.join(dir, `.temp-${Date.now()}`);
  
  return new Promise((resolve, reject) => {
    const repoUrl = "https://github.com/tmoreton/kai-skills.git";
    
    // Clone with depth 1 and filter to only get the skills directory (sparse checkout)
    exec(
      `git clone --depth 1 --filter=blob:none --sparse "${repoUrl}" "${tempDir}"`,
      { timeout: 120_000 },
      async (err, _stdout, stderr) => {
        if (err) {
          // Clean up temp dir
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
          reject(new Error(`Failed to clone kai-skills repo: ${stderr || err.message}`));
          return;
        }

        try {
          // Set up sparse checkout for the specific skill
          const skillSubdir = `skills/${skillId}`;
          
          exec(
            `cd "${tempDir}" && git sparse-checkout set "${skillSubdir}"`,
            { timeout: 30_000 },
            async (sparseErr) => {
              if (sparseErr) {
                // Fallback: try full clone and copy
                try {
                  const skillPath = path.join(tempDir, skillSubdir);
                  if (!fs.existsSync(skillPath)) {
                    throw new Error(`Skill "${skillId}" not found in kai-skills repository`);
                  }
                  
                  // Copy skill to destination
                  fs.cpSync(skillPath, destPath, { recursive: true });
                  
                  // Clean up temp dir
                  fs.rmSync(tempDir, { recursive: true, force: true });
                  
                  // Load the skill
                  const skill = await loadSkill(destPath);
                  resolve(skill.manifest.id);
                } catch (copyErr: unknown) {
                  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
                  try { fs.rmSync(destPath, { recursive: true, force: true }); } catch {}
                  const msg = copyErr instanceof Error ? copyErr.message : String(copyErr);
                  reject(new Error(`Failed to install skill: ${msg}`));
                }
                return;
              }

              try {
                const skillPath = path.join(tempDir, skillSubdir);
                
                if (!fs.existsSync(skillPath)) {
                  fs.rmSync(tempDir, { recursive: true, force: true });
                  throw new Error(`Skill "${skillId}" not found in kai-skills repository`);
                }

                // Copy skill to destination
                fs.cpSync(skillPath, destPath, { recursive: true });
                
                // Clean up temp dir
                fs.rmSync(tempDir, { recursive: true, force: true });
                
                // Compile TypeScript if needed before loading
                await compileHandlerIfNeeded(destPath);
                
                // Load the skill
                const skill = await loadSkill(destPath);
                resolve(skill.manifest.id);
              } catch (loadErr: unknown) {
                // Check if it's a config-required error (allow skill to be installed)
                const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
                
                if (msg.includes("is required") || msg.includes("environment variable")) {
                  // Skill was installed but needs configuration
                  // Don't clean up - skill is valid, just needs config
                  const skillId = path.basename(destPath);
                  console.log(`  Skill ${skillId} installed but requires configuration`);
                  resolve(skillId);
                  return;
                }
                
                // Clean up on failure
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
                try { fs.rmSync(destPath, { recursive: true, force: true }); } catch {}
                reject(new Error(`Skill copied but failed to load: ${msg}`));
              }
            }
          );
        } catch (err: unknown) {
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
          const msg = err instanceof Error ? err.message : String(err);
          reject(new Error(`Failed to install skill: ${msg}`));
        }
      }
    );
  });
}

/**
 * Detect if handler.js contains TypeScript syntax and compile it
 */
async function compileHandlerIfNeeded(skillPath: string): Promise<void> {
  const handlerPath = path.join(skillPath, "handler.js");
  if (!fs.existsSync(handlerPath)) return;
  
  const content = fs.readFileSync(handlerPath, "utf-8");
  
  // Check for TypeScript-specific syntax
  const hasTypeScript = 
    /\binterface\s+\w/.test(content) ||
    /\btype\s+\w+\s*=/.test(content) ||
    /:\s*(string|number|boolean|any|void)\b/.test(content) ||
    /\w+\s*:\s*\w+\s*=>/.test(content) ||
    /<\w+>/.test(content);
  
  if (!hasTypeScript) return;
  
  console.log(`  Detected TypeScript in ${path.basename(skillPath)}, compiling...`);
  
  try {
    const { execSync } = await import("child_process");
    
    // Copy to .ts extension for esbuild to recognize as TypeScript
    const tsPath = handlerPath.replace(/\.js$/, '.ts');
    fs.copyFileSync(handlerPath, tsPath);
    
    const tempFile = path.join(skillPath, `handler-compiled-${Date.now()}.mjs`);
    
    // Use esbuild to compile TypeScript to JavaScript
    execSync(
      `npx esbuild "${tsPath}" --bundle --outfile="${tempFile}" --format=esm --platform=node --target=node18`,
      { stdio: "pipe", timeout: 60000 }
    );
    
    // Clean up temp .ts file
    fs.unlinkSync(tsPath);
    
    // Replace original with compiled
    fs.renameSync(tempFile, handlerPath);
    console.log(`  Compiled successfully`);
  } catch (err: any) {
    // Clean up temp files on error
    try {
      const tsPath = handlerPath.replace(/\.js$/, '.ts');
      if (fs.existsSync(tsPath)) fs.unlinkSync(tsPath);
    } catch {}
    throw new Error(
      `Handler contains TypeScript but compilation failed. ` +
      `Error: ${err.message || err}`
    );
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
        // Compile TypeScript if needed before loading
        await compileHandlerIfNeeded(destPath);
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
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
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
