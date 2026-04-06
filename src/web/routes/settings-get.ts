  app.get("/api/settings", (c) => {
    const config = readUserConfig();
    const mcpServers = listMcpServers();
    const skills = getLoadedSkills();

    // Read env vars from ~/.kai/.env
    const envPath = path.resolve(process.env.HOME || "~", ".kai/.env");
    const envVars: Record<string, string> = {};
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq > 0) {
            const key = trimmed.slice(0, eq).trim();
            const value = trimmed.slice(eq + 1).trim();
            envVars[key] = value;
          }
        }
      }
    } catch {}

    // Check which required env vars are missing for each skill
    const skillsWithConfig = skills.map((s) => {
      const missingConfig: string[] = [];
      
      if (s.manifest.config_schema) {
        for (const [key, field] of Object.entries(s.manifest.config_schema)) {
          if (field.required) {
            const envKey = field.env || key;
            const hasValue = (field.env && envVars[field.env]) || envVars[key] || field.default !== undefined;
            if (!hasValue) {
              missingConfig.push(envKey);
            }
          }
        }
      }
      
      return {
        id: s.manifest.id,
        name: s.manifest.name,
        version: s.manifest.version,
        description: s.manifest.description || "",
        author: s.manifest.author || "",
        tools: s.manifest.tools.map((t: any) => ({ name: t.name, description: t.description })),
        path: s.path,
        missingConfig: missingConfig.length > 0 ? missingConfig : undefined,
      };
    });

    return c.json({
      config,
      env: envVars,
      mcp: {
        servers: mcpServers.map((s) => ({
          name: s.name,
          ready: s.ready,
          tools: s.tools,
          config: config.mcp?.servers?.[s.name] || {},
        })),
      },
      skills: skillsWithConfig,
    });
  });