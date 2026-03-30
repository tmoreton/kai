import fs from "fs";
import path from "path";
import { registerIntegration, type IntegrationHandler } from "../workflow.js";

/**
 * Custom Integration Plugin Loader
 *
 * Loads .js integration plugins from ~/.kai/integrations/ at runtime.
 * This allows users to add their own integrations without modifying source.
 *
 * Plugin format — each .js file exports a default function:
 *
 *   export default function register({ registerIntegration }) {
 *     registerIntegration({
 *       name: "my-service",
 *       description: "My custom service",
 *       actions: {
 *         do_thing: async (params, ctx) => { ... }
 *       }
 *     });
 *   }
 *
 * The ctx object provides: config, vars, env, agent_id, run_id
 */

export async function loadCustomIntegrations(): Promise<string[]> {
  const integrationsDir = path.join(
    process.env.HOME || "~",
    ".kai/integrations"
  );

  if (!fs.existsSync(integrationsDir)) return [];

  const files = fs.readdirSync(integrationsDir).filter((f) => f.endsWith(".js"));
  const loaded: string[] = [];

  for (const file of files) {
    const filePath = path.join(integrationsDir, file);
    try {
      // Dynamic import of the plugin
      const mod = await import(`file://${filePath}`);
      const registerFn = mod.default || mod.register;

      if (typeof registerFn !== "function") {
        console.error(`  Plugin ${file}: no default export function found, skipping`);
        continue;
      }

      // Call the plugin's register function with the API
      await registerFn({ registerIntegration });
      loaded.push(file);
    } catch (err: any) {
      console.error(`  Plugin ${file} failed to load: ${err.message}`);
    }
  }

  return loaded;
}
