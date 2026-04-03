/**
 * Agent Workflow Test Harness Examples
 *
 * This file demonstrates how to use the test harness for testing
 * real-world agent workflows with various step types.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestHarness,
  type TestAgentHarness,
} from "../src/agents/test-harness.js";
import { closeDb } from "../src/agents/db.js";

describe("Workflow Test Harness Examples", () => {
  let harness: TestAgentHarness;

  afterEach(async () => {
    if (harness) {
      await harness.cleanup();
    }
    closeDb();
  });

  describe("Basic Workflow Execution", () => {
    it("executes a simple shell workflow end-to-end", async () => {
      harness = await createTestHarness({ cleanup: true });

      const workflow = {
        name: "Simple Shell Workflow",
        description: "A basic workflow with shell commands",
        steps: [
          {
            name: "get_date",
            type: "shell" as const,
            command: "date -u +%Y-%m-%d",
            output_var: "current_date",
          },
          {
            name: "get_hostname",
            type: "shell" as const,
            command: "hostname",
            output_var: "hostname",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      // Verify workflow succeeded
      expect(result.success).toBe(true);

      // Verify both steps were executed
      expect(harness.wasStepExecuted("get_date")).toBe(true);
      expect(harness.wasStepExecuted("get_hostname")).toBe(true);

      // Verify step results
      harness.expectStep("get_date").toHaveCompleted();
      harness.expectStep("get_hostname").toHaveCompleted();

      // Verify variables were captured
      const date = harness.getVar("current_date");
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("handles variable passing between steps", async () => {
      harness = await createTestHarness({ cleanup: true });

      const workflow = {
        name: "Variable Chaining",
        steps: [
          {
            name: "generate_greeting",
            type: "shell" as const,
            command: "echo 'Hello World'",
            output_var: "greeting",
          },
          {
            name: "echo_greeting",
            type: "shell" as const,
            command: "echo 'Received: ${vars.greeting}'",
            output_var: "echo_result",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      expect(result.success).toBe(true);
      expect(harness.wasStepExecuted("generate_greeting")).toBe(true);
      expect(harness.wasStepExecuted("echo_greeting")).toBe(true);
    });
  });

  describe("LLM Step Mocking", () => {
    it("mocks LLM responses for consistent testing", async () => {
      harness = await createTestHarness({
        cleanup: true,
        mockResponses: {
          analyze_sentiment: "POSITIVE: The sentiment is highly positive with 95% confidence",
          extract_keywords: "KEYWORDS: ai, testing, workflows, automation",
        },
      });

      const workflow = {
        name: "Sentiment Analysis Pipeline",
        steps: [
          {
            name: "analyze_sentiment",
            type: "llm" as const,
            prompt: "Analyze the sentiment of: 'Great product!'",
            output_var: "sentiment_result",
          },
          {
            name: "extract_keywords",
            type: "llm" as const,
            prompt: "Extract keywords from: 'AI testing workflows automation'",
            output_var: "keywords_result",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      expect(result.success).toBe(true);

      // Verify mocked responses were used
      const sentiment = harness.getVar("sentiment_result");
      expect(sentiment).toContain("POSITIVE");

      const keywords = harness.getVar("keywords_result");
      expect(keywords).toContain("ai, testing, workflows");

      // Verify LLM calls were recorded
      const calls = harness.getLLMCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0].stepName).toBe("analyze_sentiment");
      expect(calls[1].stepName).toBe("extract_keywords");
    });

    it("uses default mock response for unspecified steps", async () => {
      harness = await createTestHarness({
        cleanup: true,
        defaultMockResponse: "DEFAULT: Automated response",
      });

      const workflow = {
        name: "Default Mock Test",
        steps: [
          {
            name: "unknown_llm_task",
            type: "llm" as const,
            prompt: "Do something",
            output_var: "result",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      expect(result.success).toBe(true);
      expect(harness.getVar("result")).toBe("DEFAULT: Automated response");
    });

    it("allows setting mock responses after initialization", async () => {
      harness = await createTestHarness({ cleanup: true });

      harness.setMockResponse("dynamic_step", "Dynamic mock response");

      const workflow = {
        name: "Dynamic Mock Test",
        steps: [
          {
            name: "dynamic_step",
            type: "llm" as const,
            prompt: "Test",
            output_var: "result",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      expect(harness.getVar("result")).toBe("Dynamic mock response");
    });
  });

  describe("Skill Step Testing", () => {
    it("registers and executes mock skills", async () => {
      harness = await createTestHarness({
        cleanup: true,
        mockSkills: {
          email_sender: {
            send: async (params: { to: string; subject: string; body: string }) => {
              return `Mock email sent to ${params.to} with subject: ${params.subject}`;
            },
            verify: async () => "Email credentials verified successfully",
          },
        },
      });

      const workflow = {
        name: "Email Notification Workflow",
        steps: [
          {
            name: "verify_email",
            type: "skill" as const,
            skill: "email_sender",
            action: "verify",
            output_var: "verification_result",
          },
          {
            name: "send_notification",
            type: "skill" as const,
            skill: "email_sender",
            action: "send",
            params: {
              to: "test@example.com",
              subject: "Test Notification",
              body: "This is a test",
            },
            output_var: "send_result",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      expect(result.success).toBe(true);
      expect(harness.getVar("verification_result")).toContain("verified");
      expect(harness.getVar("send_result")).toContain("test@example.com");
    });
  });

  describe("Integration Step Testing", () => {
    it("registers and executes mock integrations", async () => {
      harness = await createTestHarness({
        cleanup: true,
        mockIntegrations: {
          slack_notifier: {
            post_message: async (params: { channel: string; message: string }, ctx) => {
              return { ok: true, channel: params.channel, ts: "1234567890.123456" };
            },
            get_channels: async () => {
              return [{ id: "C123", name: "general" }, { id: "C456", name: "random" }];
            },
          },
        },
      });

      const workflow = {
        name: "Slack Notification Workflow",
        steps: [
          {
            name: "get_channels",
            type: "integration" as const,
            integration: "slack_notifier",
            action: "get_channels",
            output_var: "channels",
          },
          {
            name: "post_to_slack",
            type: "integration" as const,
            integration: "slack_notifier",
            action: "post_message",
            params: {
              channel: "general",
              message: "Test notification",
            },
            output_var: "post_result",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      expect(result.success).toBe(true);
      expect(harness.getVar("channels")).toBeDefined();
      expect(harness.getVar("post_result")).toBeDefined();
    });
  });

  describe("Configuration and Environment", () => {
    it("uses config values in workflow", async () => {
      harness = await createTestHarness({
        cleanup: true,
        config: {
          api_endpoint: "https://api.example.com",
          timeout: 30000,
          retries: 3,
        },
      });

      const workflow = {
        name: "Config Test Workflow",
        config: {
          api_endpoint: "https://default.example.com",
        },
        steps: [
          {
            name: "check_config",
            type: "shell" as const,
            command: "echo 'API: ${config.api_endpoint}, timeout: ${config.timeout}'",
            output_var: "config_output",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      expect(result.success).toBe(true);
      const output = harness.getVar("config_output");
      expect(output).toContain("https://api.example.com");
      expect(output).toContain("30000");
    });

    it("sets environment variables during execution", async () => {
      harness = await createTestHarness({
        cleanup: true,
        env: {
          TEST_API_KEY: "secret-key-123",
          TEST_REGION: "us-west-2",
        },
      });

      const workflow = {
        name: "Environment Test",
        steps: [
          {
            name: "check_env",
            type: "shell" as const,
            command: "echo $TEST_REGION",
            output_var: "region",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      expect(result.success).toBe(true);
      expect(harness.getVar("region")).toContain("us-west-2");
    });
  });

  describe("Workflow File Operations", () => {
    it("loads workflow from YAML file", async () => {
      harness = await createTestHarness({ cleanup: true });

      // Create a workflow YAML file
      const workflowContent = `
name: File-based Workflow
description: Loaded from file
config:
  source: file
steps:
  - name: file_step_1
    type: shell
    command: echo "from file step 1"
    output_var: result1
  - name: file_step_2
    type: shell
    command: echo "from file step 2"
    output_var: result2
`;
      const workflowPath = harness.createTempFile("test-workflow.yaml", workflowContent);

      // Load and execute
      const workflow = harness.loadWorkflow(workflowPath);
      expect(workflow.name).toBe("File-based Workflow");
      expect(workflow.steps).toHaveLength(2);

      const result = await harness.runWorkflow(workflow);

      expect(result.success).toBe(true);
      expect(harness.wasStepExecuted("file_step_1")).toBe(true);
      expect(harness.wasStepExecuted("file_step_2")).toBe(true);
    });

    it("writes and loads workflow YAML", async () => {
      harness = await createTestHarness({ cleanup: true });

      const workflow = {
        name: "Written Workflow",
        description: "Written to file then loaded",
        steps: [
          {
            name: "written_step",
            type: "shell" as const,
            command: "echo 'written'",
            output_var: "result",
          },
        ],
      };

      const path = harness.writeWorkflowYaml("written.yaml", workflow);
      const loaded = harness.loadWorkflow(path);

      expect(loaded.name).toBe("Written Workflow");

      const result = await harness.runWorkflow(loaded);
      expect(result.success).toBe(true);
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("handles step errors gracefully", async () => {
      harness = await createTestHarness({ cleanup: true });

      const workflow = {
        name: "Error Handling Workflow",
        steps: [
          {
            name: "successful_step",
            type: "shell" as const,
            command: "echo 'success'",
            output_var: "success_result",
          },
          {
            name: "failing_step",
            type: "shell" as const,
            command: "nonexistent_command_xyz",
            output_var: "fail_result",
          },
          {
            name: "after_failure",
            type: "shell" as const,
            command: "echo 'continues after error'",
            output_var: "after_result",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      // Workflow continues even if individual steps fail
      expect(harness.wasStepExecuted("successful_step")).toBe(true);
      expect(harness.wasStepExecuted("failing_step")).toBe(true);
      expect(harness.wasStepExecuted("after_failure")).toBe(true);

      // Check individual step statuses
      harness.expectStep("successful_step").toHaveCompleted();
      harness.expectStep("failing_step").toHaveFailed();
      harness.expectStep("after_failure").toHaveCompleted();
    });

    it("provides detailed step information for debugging", async () => {
      harness = await createTestHarness({
        cleanup: true,
        mockResponses: {
          debug_step: "Debug output content",
        },
      });

      const workflow = {
        name: "Debug Workflow",
        steps: [
          {
            name: "debug_step",
            type: "llm" as const,
            prompt: "Debug this",
            output_var: "debug_output",
          },
        ],
      };

      await harness.runWorkflow(workflow);

      // Get all results
      const results = harness.getResults();
      expect(Object.keys(results)).toContain("debug_output");

      // Get all steps
      const steps = harness.getSteps();
      expect(steps).toHaveLength(1);
      expect(steps[0].step_name).toBe("debug_step");
      expect(steps[0].status).toBe("completed");
    });
  });

  describe("Complex Workflow Patterns", () => {
    it("executes multi-step workflows with mixed types", async () => {
      harness = await createTestHarness({
        cleanup: true,
        mockResponses: {
          analyze: "ANALYSIS: Data shows 150 records",
          summarize: "SUMMARY: Key findings processed",
        },
        mockSkills: {
          data_processor: {
            transform: async (params: { data: string }) => {
              return `Transformed: ${params.data}`;
            },
          },
        },
      });

      const workflow = {
        name: "Complex Data Pipeline",
        steps: [
          {
            name: "fetch_data",
            type: "shell" as const,
            command: "echo 'raw data'",
            output_var: "raw_data",
          },
          {
            name: "analyze",
            type: "llm" as const,
            prompt: "Analyze ${vars.raw_data}",
            output_var: "analysis",
          },
          {
            name: "transform",
            type: "skill" as const,
            skill: "data_processor",
            action: "transform",
            params: { data: "${vars.analysis}" },
            output_var: "transformed",
          },
          {
            name: "summarize",
            type: "llm" as const,
            prompt: "Summarize ${vars.transformed}",
            output_var: "summary",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      expect(result.success).toBe(true);
      expect(harness.wasStepExecuted("fetch_data")).toBe(true);
      expect(harness.wasStepExecuted("analyze")).toBe(true);
      expect(harness.wasStepExecuted("transform")).toBe(true);
      expect(harness.wasStepExecuted("summarize")).toBe(true);

      // Verify data flow
      expect(harness.getVar("analysis")).toContain("150 records");
      expect(harness.getVar("summary")).toContain("Key findings");
    });

    it("handles conditional step execution", async () => {
      harness = await createTestHarness({
        cleanup: true,
        config: { run_optional: true },
      });

      const workflow = {
        name: "Conditional Workflow",
        steps: [
          {
            name: "always_runs",
            type: "shell" as const,
            command: "echo 'always'",
            output_var: "always_result",
          },
          {
            name: "conditional_step",
            type: "shell" as const,
            condition: "${config.run_optional}",
            command: "echo 'conditional'",
            output_var: "conditional_result",
          },
          {
            name: "skipped_step",
            type: "shell" as const,
            condition: "false",
            command: "echo 'should not run'",
            output_var: "skipped_result",
          },
        ],
      };

      const result = await harness.runWorkflow(workflow);

      expect(harness.wasStepExecuted("always_runs")).toBe(true);
      // Conditional step behavior depends on condition evaluation
      expect(harness.wasStepExecuted("skipped_step")).toBe(false);
    });
  });

  describe("Assertion Helpers", () => {
    it("provides detailed step assertions", async () => {
      harness = await createTestHarness({
        cleanup: true,
        mockResponses: {
          generate_report: "Report: 50 tests passed, 0 failed",
        },
      });

      const workflow = {
        name: "Report Generation",
        steps: [
          {
            name: "generate_report",
            type: "llm" as const,
            prompt: "Generate test report",
            output_var: "report",
          },
          {
            name: "save_report",
            type: "shell" as const,
            command: "echo 'Report saved'",
            output_var: "save_result",
          },
        ],
      };

      await harness.runWorkflow(workflow);

      // Test various assertions
      harness.expectStep("generate_report").toHaveCompleted();
      harness.expectStep("generate_report").toHaveOutputContaining("50 tests");
      harness.expectStep("save_report").toHaveCompleted();
      harness.expectStep("save_report").toHaveOutput("Report saved");

      // Verify variable exists
      harness.expectStep("generate_report").toHaveVar("report");
    });

    it("validates workflow success and failure", async () => {
      harness = await createTestHarness({ cleanup: true });

      // Success case
      const successWorkflow = {
        name: "Success Workflow",
        steps: [
          {
            name: "good_step",
            type: "shell" as const,
            command: "echo 'ok'",
          },
        ],
      };

      await harness.runWorkflow(successWorkflow);
      harness.expectSuccess();

      // Failure case
      const failWorkflow = {
        name: "Failure Workflow",
        steps: [
          {
            name: "bad_step",
            type: "shell" as const,
            command: "exit 1",
          },
        ],
      };

      await harness.runWorkflow(failWorkflow);
      // Individual step should be marked as failed
      harness.expectStep("bad_step").toHaveFailed();
    });
  });

  describe("Best Practices", () => {
    it("demonstrates complete test setup pattern", async () => {
      // 1. Create harness with appropriate mocks
      harness = await createTestHarness({
        cleanup: true,
        mockResponses: {
          llm_analysis: "Analysis complete",
        },
        mockSkills: {
          external_api: {
            fetch: async () => "API data",
          },
        },
        config: {
          api_key: "test-key",
          environment: "test",
        },
      });

      // 2. Create workflow (can load from file or define inline)
      const workflow = {
        name: "Best Practice Example",
        steps: [
          {
            name: "llm_analysis",
            type: "llm" as const,
            prompt: "Analyze data",
            output_var: "analysis",
          },
          {
            name: "fetch_data",
            type: "skill" as const,
            skill: "external_api",
            action: "fetch",
            output_var: "api_data",
          },
          {
            name: "combine_results",
            type: "shell" as const,
            command: "echo 'Combined: ${vars.analysis} + ${vars.api_data}'",
            output_var: "combined",
          },
        ],
      };

      // 3. Execute workflow
      const result = await harness.runWorkflow(workflow);

      // 4. Verify results
      expect(result.success).toBe(true);

      // 5. Use specific assertions
      harness.expectStep("llm_analysis").toHaveCompleted();
      harness.expectStep("llm_analysis").toHaveOutput("Analysis complete");
      harness.expectStep("fetch_data").toHaveCompleted();

      // 6. Verify data flow
      expect(harness.getVar("analysis")).toBe("Analysis complete");
      expect(harness.getVar("api_data")).toBe("API data");

      // 7. Verify all steps executed
      expect(harness.getSteps()).toHaveLength(3);
    });

    it("demonstrates testing individual workflow components", async () => {
      harness = await createTestHarness({ cleanup: true });

      // Test just the shell execution part
      const shellOnlyWorkflow = {
        name: "Shell Component Test",
        steps: [
          {
            name: "list_files",
            type: "shell" as const,
            command: "ls -la",
            output_var: "files",
          },
        ],
      };

      const result = await harness.runWorkflow(shellOnlyWorkflow);

      expect(result.success).toBe(true);
      // Output will vary by system, but step should complete
      harness.expectStep("list_files").toHaveCompleted();

      // Test just the LLM part
      harness.setMockResponse("llm_only", "LLM output");
      const llmOnlyWorkflow = {
        name: "LLM Component Test",
        steps: [
          {
            name: "llm_only",
            type: "llm" as const,
            prompt: "Test",
            output_var: "llm_result",
          },
        ],
      };

      const llmResult = await harness.runWorkflow(llmOnlyWorkflow);
      expect(llmResult.success).toBe(true);
      expect(harness.getVar("llm_result")).toBe("LLM output");
    });
  });
});
