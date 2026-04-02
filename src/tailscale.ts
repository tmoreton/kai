import { execSync } from "child_process";

// Tailscale CLI path varies by platform
const TAILSCALE_PATHS = [
  "tailscale",                                          // In PATH (Linux, Homebrew)
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale", // macOS app
  "/usr/bin/tailscale",                                  // Linux package
];

function findTailscaleCli(): string | null {
  for (const bin of TAILSCALE_PATHS) {
    try {
      execSync(`${bin} version`, { stdio: "ignore" });
      return bin;
    } catch {
      // Not found at this path
    }
  }
  return null;
}

interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  hostname?: string;
  tailscaleIp?: string;
  dnsName?: string;
}

export function getTailscaleStatus(): TailscaleStatus {
  const cli = findTailscaleCli();
  if (!cli) return { installed: false, running: false };

  try {
    const raw = execSync(`${cli} status --json`, { encoding: "utf-8", timeout: 5000 });
    const status = JSON.parse(raw);
    return {
      installed: true,
      running: status.BackendState === "Running",
      hostname: status.Self?.HostName,
      tailscaleIp: status.TailscaleIPs?.[0],
      dnsName: status.Self?.DNSName?.replace(/\.$/, ""), // Remove trailing dot
    };
  } catch {
    return { installed: true, running: false };
  }
}

export interface TailscaleServeOptions {
  port: number;
  funnel?: boolean; // Expose to the public internet (not just tailnet)
}

/**
 * Start Tailscale serve/funnel to expose a local port.
 * Uses --bg to run in background mode.
 * Returns the Tailscale URL on success.
 */
export async function startTailscaleServe(options: TailscaleServeOptions): Promise<string> {
  const cli = findTailscaleCli();
  if (!cli) {
    throw new Error(
      "Tailscale CLI not found. Install Tailscale: https://tailscale.com/download"
    );
  }

  const status = getTailscaleStatus();
  if (!status.running) {
    throw new Error(
      "Tailscale is not running. Start Tailscale and log in first."
    );
  }

  const command = options.funnel ? "funnel" : "serve";
  const url = `http://localhost:${options.port}`;

  try {
    // Start in background mode
    execSync(`${cli} ${command} --bg ${options.port}`, {
      encoding: "utf-8",
      timeout: 60000,
      stdio: "pipe",
    });

    // Build the accessible URL from DNS name
    const tailscaleUrl = status.dnsName
      ? `https://${status.dnsName}`
      : `https://${status.tailscaleIp}`;

    return tailscaleUrl;
  } catch (err: any) {
    const msg = err.stderr || err.message || String(err);
    throw new Error(`Failed to start tailscale ${command}: ${msg}`);
  }
}

/**
 * Stop Tailscale serve/funnel and reset the config.
 */
export function stopTailscaleServe(funnel?: boolean): void {
  const cli = findTailscaleCli();
  if (!cli) return;

  const command = funnel ? "funnel" : "serve";
  try {
    execSync(`${cli} ${command} reset`, { stdio: "ignore", timeout: 5000 });
  } catch {
    // Ignore errors during cleanup
  }
}
