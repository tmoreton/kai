/**
 * Browser Skill Handler — Playwright-based web browsing
 *
 * Provides tools to navigate pages, interact with elements,
 * take screenshots, and extract content using a real browser.
 */

import { createRequire } from "module";
import fs from "fs";
import path from "path";

const CONTENT_LIMIT = 80000;
const NAV_TIMEOUT_MS = 30000;

let browser = null;
let page = null;

function loadPlaywright() {
  // Resolve playwright from the app's node_modules (not the skill directory)
  const require = createRequire(process.cwd() + "/package.json");
  return require("playwright");
}

async function ensureBrowser() {
  if (browser && page) return page;

  let playwright;
  try {
    playwright = loadPlaywright();
  } catch {
    throw new Error(
      "Playwright is not installed. Run: npm install playwright && npx playwright install chromium"
    );
  }

  browser = await playwright.chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT_MS);
  return page;
}

function extractReadableText(html) {
  // Strip scripts, styles, and tags to get readable text
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default {
  install: async () => {
    try {
      const { execSync } = await import("child_process");
      const fs = await import("fs");
      const pw = loadPlaywright();
      const execPath = pw.chromium.executablePath();
      if (!fs.existsSync(execPath)) {
        console.log("  Installing Playwright Chromium...");
        execSync("npx playwright install chromium", { stdio: "inherit" });
      }
    } catch {
      // Playwright package not installed — will fail at action time with a clear message
    }
  },

  uninstall: async () => {
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
      page = null;
    }
  },

  actions: {
    open: async (params) => {
      const p = await ensureBrowser();
      await p.goto(params.url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      if (params.wait_for) {
        await p.waitForSelector(params.wait_for, { timeout: 10000 }).catch(() => {});
      }

      // Give JS a moment to render
      await p.waitForTimeout(1000);

      const title = await p.title();
      const url = p.url();
      const html = await p.content();
      const text = extractReadableText(html);

      return JSON.stringify({
        title,
        url,
        content: text.substring(0, CONTENT_LIMIT),
        content_length: text.length,
      });
    },

    click: async (params) => {
      const p = await ensureBrowser();
      const CLICK_TIMEOUT = 5000;

      try {
        if (params.selector) {
          await p.click(params.selector, { timeout: CLICK_TIMEOUT });
        } else if (params.text) {
          await p.getByText(params.text, { exact: false }).first().click({ timeout: CLICK_TIMEOUT });
        } else {
          throw new Error("Provide either 'selector' or 'text' to identify the element to click");
        }
      } catch (err) {
        // On timeout, return visible clickable elements to help the model pick the right one
        const clickables = await p.evaluate(() => {
          const els = document.querySelectorAll("a, button, input, select, textarea, [role='button'], [onclick]");
          return [...els].slice(0, 30).map(el => ({
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute("type"),
            text: (el.textContent || "").trim().substring(0, 80),
            placeholder: el.getAttribute("placeholder"),
            name: el.getAttribute("name"),
            id: el.id || undefined,
            class: el.className ? el.className.substring(0, 60) : undefined,
          }));
        });
        throw new Error(
          `Could not find element to click (${params.selector || params.text}). ` +
          `Available clickable elements:\n${JSON.stringify(clickables, null, 2)}`
        );
      }

      await p.waitForTimeout(1000);

      const title = await p.title();
      const url = p.url();
      return JSON.stringify({ clicked: true, title, url });
    },

    fill: async (params) => {
      const p = await ensureBrowser();
      await p.fill(params.selector, params.value);
      return JSON.stringify({ filled: true, selector: params.selector });
    },

    screenshot: async (params) => {
      const p = await ensureBrowser();

      let buffer;
      if (params.selector) {
        const element = p.locator(params.selector);
        buffer = await element.screenshot({ type: "png" });
      } else {
        buffer = await p.screenshot({
          type: "png",
          fullPage: params.full_page || false,
        });
      }

      const title = await p.title();
      const url = p.url();

      // Save to disk instead of returning base64 inline
      const homeDir = process.env.HOME || "~";
      const outDir = path.join(homeDir, ".kai", "agent-output", "screenshots");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `browser-${Date.now()}.png`);
      fs.writeFileSync(outPath, buffer);

      return JSON.stringify({
        type: "image_result",
        title,
        url,
        path: outPath,
        size_kb: Math.round(buffer.length / 1024),
      });
    },

    evaluate: async (params) => {
      const p = await ensureBrowser();
      // Wrap in an async IIFE so `return` statements work,
      // and fall back to bare expression evaluation
      let result;
      try {
        result = await p.evaluate(`(async () => { ${params.script} })()`);
      } catch {
        result = await p.evaluate(params.script);
      }
      return JSON.stringify({ result });
    },

    get_content: async () => {
      const p = await ensureBrowser();
      const title = await p.title();
      const url = p.url();
      const html = await p.content();
      const text = extractReadableText(html);

      return JSON.stringify({
        title,
        url,
        content: text.substring(0, CONTENT_LIMIT),
        content_length: text.length,
      });
    },

    close: async () => {
      if (browser) {
        await browser.close().catch(() => {});
        browser = null;
        page = null;
        return JSON.stringify({ closed: true });
      }
      return JSON.stringify({ closed: false, message: "No browser session active" });
    },
  },
};
