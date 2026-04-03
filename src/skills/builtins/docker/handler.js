/**
 * Docker Skill Handler - Container Management
 * 
 * Provides Docker build, run, compose, and monitoring operations
 */

import { execSync, spawn } from "child_process";
import fs from "fs";

function exec(command, options = {}) {
  try {
    return { success: true, output: execSync(command, { encoding: "utf-8", stdio: "pipe", ...options }) };
  } catch (e) {
    return { success: false, output: e.stdout || e.stderr || e.message, exitCode: e.status };
  }
}

function fileExists(path) {
  try {
    fs.accessSync(path);
    return true;
  } catch {
    return false;
  }
}

function generateTag() {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const gitResult = exec("git rev-parse --short HEAD 2>/dev/null || echo 'latest'");
  return `${timestamp}-${gitResult.output?.trim() || "latest"}`;
}

export default {
  actions: {
    docker_build: (params) => {
      const { tag, dockerfile = "Dockerfile", context = ".", push = false, no_cache = false } = params;
      
      const imageTag = tag || generateTag();
      
      // Check if Dockerfile exists
      if (!fileExists(dockerfile)) {
        return { content: `Dockerfile not found: ${dockerfile}`, error: true };
      }
      
      let cmd = `docker build -t ${imageTag} -f ${dockerfile}`;
      if (no_cache) cmd += " --no-cache";
      cmd += ` ${context}`;
      
      const result = exec(cmd, { timeout: 300000 });
      
      let output = result.output || "Build completed";
      
      if (push && result.success) {
        const pushResult = exec(`docker push ${imageTag}`, { timeout: 300000 });
        output += "\n\n" + (pushResult.output || "Push completed");
      }
      
      return { 
        content: output,
        success: result.success,
        imageTag
      };
    },

    docker_run: (params) => {
      const { 
        image, 
        name, 
        ports = [], 
        env = {}, 
        volumes = [], 
        detach = true,
        remove = false 
      } = params;
      
      const containerName = name || `${image.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${Date.now().toString(36).slice(-4)}`;
      
      let cmd = "docker run";
      
      if (detach) cmd += " -d";
      if (remove) cmd += " --rm";
      cmd += ` --name ${containerName}`;
      
      // Add ports
      for (const port of ports) {
        cmd += ` -p ${port}`;
      }
      
      // Add environment variables
      for (const [key, value] of Object.entries(env)) {
        cmd += ` -e ${key}="${value.replace(/"/g, '\\"')}"`;
      }
      
      // Add volumes
      for (const vol of volumes) {
        cmd += ` -v ${vol}`;
      }
      
      cmd += ` ${image}`;
      
      const result = exec(cmd, { timeout: 60000 });
      
      if (!result.success) {
        return { 
          content: `Failed to start container:\n${result.output}`,
          error: true,
          exitCode: result.exitCode
        };
      }
      
      const containerId = result.output?.trim();
      
      return { 
        content: `Container started: ${containerName}\nID: ${containerId}\nStatus: ${detach ? "running in background" : "running"}`,
        containerName,
        containerId,
        success: true
      };
    },

    docker_compose_up: (params) => {
      const { services = [], build = false, detach = true, file } = params;
      
      let cmd = "docker-compose";
      if (file) cmd += ` -f ${file}`;
      cmd += " up";
      
      if (detach) cmd += " -d";
      if (build) cmd += " --build";
      
      if (services.length > 0) {
        cmd += " " + services.join(" ");
      }
      
      const result = exec(cmd, { timeout: 120000 });
      
      return { 
        content: result.output || "Services started",
        success: result.success
      };
    },

    docker_compose_down: (params) => {
      const { volumes = false, file } = params;
      
      let cmd = "docker-compose";
      if (file) cmd += ` -f ${file}`;
      cmd += " down";
      
      if (volumes) cmd += " -v";
      
      const result = exec(cmd, { timeout: 60000 });
      
      return { 
        content: result.output || "Services stopped",
        success: result.success
      };
    },

    docker_logs: (params) => {
      const { container, follow = false, tail = 100, since } = params;
      
      let cmd = `docker logs ${container}`;
      
      if (follow) {
        // For follow mode, start a process and return
        const child = spawn("docker", ["logs", "-f", container], { 
          detached: true,
          stdio: "pipe"
        });
        
        return { 
          content: `Following logs for ${container} (PID: ${child.pid})`,
          pid: child.pid,
          follow: true
        };
      } else {
        cmd += ` --tail ${tail}`;
        if (since) cmd += ` --since ${since}`;
        
        const result = exec(cmd, { timeout: 30000 });
        
        let output = result.output || "No logs available";
        
        // Truncate if too long
        const lines = output.split("\n");
        if (lines.length > tail + 2) {
          output = lines.slice(-tail).join("\n");
          output += `\n... (${lines.length - tail} more lines)`;
        }
        
        return { content: output };
      }
    },

    docker_status: (params) => {
      const { all = false, format = "table" } = params;
      
      let cmd = "docker ps";
      if (all) cmd += " -a";
      
      if (format === "json") {
        cmd += " --format '{{json .}}'";
        const result = exec(cmd);
        
        if (!result.output?.trim()) {
          return { 
            content: all ? "No containers found" : "No running containers",
            containers: []
          };
        }
        
        const lines = result.output.trim().split("\n");
        const containers = lines.map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        }).filter(Boolean);
        
        return { 
          content: JSON.stringify(containers, null, 2),
          containers
        };
      } else {
        // Table format with stats
        const ps = exec(cmd);
        
        if (!ps.output?.trim()) {
          return { content: all ? "No containers found" : "No running containers" };
        }
        
        // Get resource usage for running containers
        const stats = exec("docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null || echo ''");
        
        let output = ps.output;
        
        if (stats.output?.trim()) {
          output += "\n\nResource Usage:\n" + stats.output;
        }
        
        return { content: output };
      }
    }
  }
};
