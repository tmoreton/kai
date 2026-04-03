/**
 * Testing Skill Handler - Test Runner Integration
 * 
 * Provides test execution, result parsing, and coverage analysis
 */

import { createRequire } from "module";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const require = createRequire(process.cwd() + "/package.json");

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

// Cache for detected framework
let detectedFramework = null;

function detectFramework() {
  if (detectedFramework) return detectedFramework;
  
  // Check package.json
  if (fileExists("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      if (deps.jest) {
        detectedFramework = "jest";
        return "jest";
      }
      if (deps.vitest) {
        detectedFramework = "vitest";
        return "vitest";
      }
      if (deps.mocha) {
        detectedFramework = "mocha";
        return "mocha";
      }
      if (deps.tap) {
        detectedFramework = "tap";
        return "tap";
      }
    } catch {}
  }
  
  // Check for config files
  if (fileExists("jest.config.js") || fileExists("jest.config.ts")) {
    detectedFramework = "jest";
    return "jest";
  }
  if (fileExists("vitest.config.ts") || fileExists("vitest.config.js")) {
    detectedFramework = "vitest";
    return "vitest";
  }
  if (fileExists(".mocharc.js") || fileExists(".mocharc.json")) {
    detectedFramework = "mocha";
    return "mocha";
  }
  
  // Check for test files
  const testPatterns = ["**/*.test.{js,ts}", "**/*.spec.{js,ts}", "test/**/*.{js,ts}"];
  for (const pattern of testPatterns) {
    const result = exec(`find . -type f -name "${pattern.replace(/\*\*/g, "*").replace(/\{.*\}/, "*")}" 2>/dev/null | head -1`);
    if (result.output?.trim()) {
      // Default to jest for JS/TS tests
      detectedFramework = "jest";
      return "jest";
    }
  }
  
  // Check for Python
  if (fileExists("pytest.ini") || fileExists("setup.cfg") || fileExists("pyproject.toml")) {
    detectedFramework = "pytest";
    return "pytest";
  }
  
  detectedFramework = "unknown";
  return "unknown";
}

function getTestCommand(framework, params) {
  const { watch = false, coverage = false, filter, fail_fast = false } = params;
  
  let cmd;
  
  switch (framework) {
    case "jest":
      cmd = "npx jest";
      if (watch) cmd += " --watch";
      if (coverage) cmd += " --coverage";
      if (fail_fast) cmd += " --bail";
      if (filter) cmd += ` --testNamePattern="${filter}"`;
      break;
      
    case "vitest":
      cmd = "npx vitest";
      if (watch) cmd += " --watch";
      if (coverage) cmd += " --coverage";
      if (!watch) cmd += " run";
      if (filter) cmd += ` -t "${filter}"`;
      break;
      
    case "mocha":
      cmd = "npx mocha";
      if (watch) cmd += " --watch";
      if (fail_fast) cmd += " --bail";
      if (filter) cmd += ` --grep "${filter}"`;
      break;
      
    case "pytest":
      cmd = "pytest";
      if (coverage) cmd += " --cov";
      if (fail_fast) cmd += " -x";
      if (filter) cmd += ` -k "${filter}"`;
      break;
      
    default:
      cmd = "npm test";
  }
  
  return cmd;
}

function detectFormat(output) {
  if (output.includes("PASS") && output.includes("FAIL")) return "jest";
  if (output.includes("Duration:") && output.includes(" Tests ")) return "vitest";
  if (output.includes("passing") && output.includes("failing")) return "mocha";
  if (output.includes("ok") && output.includes("not ok")) return "tap";
  return "jest";
}

function extractFailedTests(output, format) {
  const failed = [];
  const lines = output.split("\n");
  
  if (format === "jest" || format === "vitest") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("FAIL") || line.includes("●")) {
        const name = line.replace(/.*●\s*/, "").trim();
        let error = "";
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j].includes("Error:") || lines[j].includes("expect")) {
            error = lines[j].trim();
            break;
          }
        }
        failed.push({ name, error });
      }
    }
  } else if (format === "mocha") {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^\s+\d+\)/)) {
        const name = lines[i].replace(/^\s+\d+\)\s*/, "").trim();
        const error = lines[i + 1]?.trim();
        failed.push({ name, error });
      }
    }
  }
  
  return failed;
}

export default {
  actions: {
    test_run: (params) => {
      const { command, watch = false } = params;
      
      let cmd;
      
      if (command) {
        cmd = command;
      } else {
        const framework = detectFramework();
        if (framework === "unknown") {
          return { content: "Could not detect test framework. Please specify a command." };
        }
        cmd = getTestCommand(framework, params);
      }
      
      const result = exec(cmd, { timeout: watch ? 10000 : 120000 });
      
      // Store last results
      try {
        fs.writeFileSync("/tmp/kai-last-test-results.txt", result.output || "");
      } catch {}
      
      const status = result.success ? "✓" : "✗";
      const exitInfo = result.exitCode !== undefined ? ` (exit ${result.exitCode})` : "";
      
      return { 
        content: `${status} Tests${exitInfo}\n\n${result.output}`,
        success: result.success,
        exitCode: result.exitCode
      };
    },

    test_analyze_results: (params) => {
      const { results, format = "auto" } = params;
      
      let testOutput;
      
      if (results) {
        testOutput = results;
      } else {
        try {
          testOutput = fs.readFileSync("/tmp/kai-last-test-results.txt", "utf-8") || "No previous test results found";
        } catch {
          return { content: "No test results to analyze. Run tests first." };
        }
      }
      
      const detectedFormat = format === "auto" ? detectFormat(testOutput) : format;
      
      const analysis = [];
      
      // Extract failed tests
      const failedTests = extractFailedTests(testOutput, detectedFormat);
      if (failedTests.length > 0) {
        analysis.push(`**${failedTests.length} test(s) failed:**`);
        for (const test of failedTests.slice(0, 10)) {
          analysis.push(`  • ${test.name}`);
          if (test.error) {
            analysis.push(`    ${test.error.substring(0, 100)}...`);
          }
        }
      }
      
      // Look for common patterns
      if (testOutput.includes("Cannot find module")) {
        analysis.push("\n⚠️ Missing dependencies detected. Run `npm install`.");
      }
      
      if (testOutput.includes("Timeout")) {
        analysis.push("\n⚠️ Tests timing out. Check for async operations without proper cleanup.");
      }
      
      if (testOutput.includes("snapshot")) {
        analysis.push("\nℹ️ Snapshot test failures. Run with --updateSnapshot to update.");
      }
      
      if (testOutput.includes("cannot read property")) {
        analysis.push("\n⚠️ Null/undefined errors. Check for missing mock data.");
      }
      
      return { 
        content: analysis.length > 0 ? analysis.join("\n") : "No specific issues detected in test output."
      };
    },

    test_coverage_report: (params) => {
      const { threshold = 80, format = "text", show_uncovered = true } = params;
      
      // First run tests with coverage
      const framework = detectFramework();
      const cmd = getTestCommand(framework, { coverage: true });
      
      exec(cmd, { timeout: 120000 });
      
      // Check for coverage files
      let report = "Coverage report generated.\n";
      
      if (fileExists("coverage/lcov-report/index.html")) {
        report += "View HTML report at: coverage/lcov-report/index.html\n";
      }
      
      if (fileExists("coverage/coverage-summary.json")) {
        try {
          const data = JSON.parse(fs.readFileSync("coverage/coverage-summary.json", "utf-8"));
          const total = data.total;
          
          if (total) {
            report += `\n**Overall Coverage:**\n`;
            report += `- Lines: ${total.lines?.pct || "N/A"}%\n`;
            report += `- Statements: ${total.statements?.pct || "N/A"}%\n`;
            report += `- Functions: ${total.functions?.pct || "N/A"}%\n`;
            report += `- Branches: ${total.branches?.pct || "N/A"}%\n`;
          }
          
          if (show_uncovered) {
            let lowCoverage = [];
            for (const [file, stats] of Object.entries(data)) {
              if (file === "total") continue;
              if (stats.lines && stats.lines.pct < threshold) {
                lowCoverage.push(`${file}: ${stats.lines.pct}% lines`);
              }
            }
            
            if (lowCoverage.length > 0) {
              report += `\n**Files below ${threshold}% coverage:**\n`;
              report += lowCoverage.slice(0, 20).join("\n");
            }
          }
        } catch (e) {
          report += "Could not parse coverage summary.";
        }
      }
      
      return { content: report };
    },

    test_watch_start: (params) => {
      const { command, filter } = params;
      
      let cmd;
      
      if (command) {
        cmd = command;
      } else {
        const framework = detectFramework();
        cmd = getTestCommand(framework, { watch: true, filter });
      }
      
      const result = exec(cmd, { timeout: 5000 });
      
      return { 
        content: `Test watcher started:\n${result.output || "Running..."}`,
        pid: process.pid
      };
    },

    test_detect_framework: () => {
      const framework = detectFramework();
      return { 
        content: `Detected test framework: ${framework}`,
        framework
      };
    }
  }
};
