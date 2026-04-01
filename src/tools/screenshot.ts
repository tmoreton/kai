import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { kaiPath } from "../config.js";

/**
 * Screenshot Tool
 *
 * Captures screenshots on macOS using native `screencapture`.
 * Returns the file path to the saved screenshot.
 * The image can then be fed back to the LLM as vision input.
 */

export interface ScreenshotArgs {
  region?: "full" | "window" | "selection";
  output_path?: string;
}

export async function takeScreenshot(args: ScreenshotArgs): Promise<string> {
  const platform = os.platform();
  if (platform !== "darwin") {
    return `Screenshot is currently only supported on macOS. Detected platform: ${platform}`;
  }

  const outDir = kaiPath("agent-output", "screenshots");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = args.output_path || path.join(outDir, `screenshot-${Date.now()}.png`);
  const region = args.region || "full";

  // Build screencapture flags
  let flags = "-x"; // no sound
  if (region === "window") flags += " -w";
  else if (region === "selection") flags += " -s";

  const cmd = `screencapture ${flags} "${outPath}"`;

  return new Promise((resolve) => {
    exec(cmd, { timeout: 15_000 }, (err, _stdout, stderr) => {
      if (err) {
        resolve(`Screenshot failed: ${stderr || err.message}`);
        return;
      }
      if (!fs.existsSync(outPath)) {
        resolve("Screenshot was cancelled or failed to save.");
        return;
      }
      const stat = fs.statSync(outPath);
      const sizeKB = Math.round(stat.size / 1024);

      // Read as base64 data URL for vision model consumption
      const base64 = fs.readFileSync(outPath).toString("base64");
      const dataUrl = `data:image/png;base64,${base64}`;

      resolve(JSON.stringify({
        type: "image_result",
        path: outPath,
        size_kb: sizeKB,
        data_url: dataUrl,
      }));
    });
  });
}
