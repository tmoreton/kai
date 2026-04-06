/**
 * A/B Testing Framework for Agent Workflow Experiments
 * 
 * Allows running workflow variants to compare performance.
 * Each variant is a modified version of the base workflow with small changes.
 * Results are stored in SQLite for statistical comparison.
 * 
 * Exports:
 * - createExperiment(agentId, variants): Create a new experiment with workflow variants
 * - runVariant(variantId, workflow): Run a specific variant and record results
 * - compareResults(experimentId): Compare all variant results for an experiment
 */

import { getDb } from "../../agents-core/db.js";
import { executeWorkflow, type WorkflowDefinition, type WorkflowStep } from "../../agents-core/workflow.js";
import crypto from "crypto";

// --- Database Schema (adds to existing db.ts tables) ---
// experiments, experiment_variants, experiment_runs

// --- Types ---

export interface ExperimentVariant {
  id: string;
  experimentId: string;
  name: string;
  description: string;
  configOverrides: Record<string, any>;
  workflowModifications: WorkflowModification[];
  runCount: number;
  createdAt: string;
}

export interface WorkflowModification {
  type: "step-replace" | "step-add" | "step-remove" | "step-modify" | "config-override";
  target: string; // step name or config key
  value: any;
  reason: string;
}

export interface Experiment {
  id: string;
  agentId: string;
  name: string;
  description: string;
  baseWorkflowPath: string;
  status: "draft" | "running" | "completed" | "cancelled";
  hypothesis: string;
  successMetric: string; // e.g., "success_rate", "avg_duration", "token_efficiency"
  minRunsPerVariant: number;
  createdAt: string;
  completedAt?: string;
}

export interface ExperimentRun {
  id: string;
  experimentId: string;
  variantId: string;
  runId: string; // Links to runs table
  status: "pending" | "running" | "completed" | "failed";
  metrics: ExperimentMetrics;
  startedAt: string;
  completedAt?: string;
}

export interface ExperimentMetrics {
  durationMs: number;
  success: boolean;
  tokenCount: number;
  stepCount: number;
  error?: string;
  customMetrics?: Record<string, number>;
}

export interface VariantResult {
  variant: ExperimentVariant;
  runs: ExperimentRun[];
  aggregated: AggregatedMetrics;
}

export interface AggregatedMetrics {
  totalRuns: number;
  successCount: number;
  successRate: number;
  avgDurationMs: number;
  avgTokenCount: number;
  stdDurationMs: number;
  stdTokenCount: number;
  confidenceInterval: {
    successRate: [number, number]; // 95% CI
    avgDurationMs: [number, number];
  };
}

export interface ComparisonResult {
  experiment: Experiment;
  variants: VariantResult[];
  winner: {
    variantId: string;
    variantName: string;
    confidence: number;
    reason: string;
  } | null;
  statisticalSignificance: boolean;
  recommendation: string;
}

// --- Database Initialization ---

export function initExperimentTables(): void {
  const db = getDb();
  db.exec(`
    -- Experiments table
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      base_workflow_path TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      hypothesis TEXT,
      success_metric TEXT DEFAULT 'success_rate',
      min_runs_per_variant INTEGER DEFAULT 10,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    -- Experiment variants
    CREATE TABLE IF NOT EXISTS experiment_variants (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      config_overrides TEXT DEFAULT '{}',
      workflow_modifications TEXT DEFAULT '[]',
      run_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
    );

    -- Experiment runs (links to main runs table)
    CREATE TABLE IF NOT EXISTS experiment_runs (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      duration_ms INTEGER,
      success INTEGER,
      token_count INTEGER DEFAULT 0,
      step_count INTEGER DEFAULT 0,
      error TEXT,
      custom_metrics TEXT DEFAULT '{}',
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
      FOREIGN KEY (variant_id) REFERENCES experiment_variants(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_experiments_agent ON experiments(agent_id);
    CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
    CREATE INDEX IF NOT EXISTS idx_variants_experiment ON experiment_variants(experiment_id);
    CREATE INDEX IF NOT EXISTS idx_exp_runs_experiment ON experiment_runs(experiment_id);
    CREATE INDEX IF NOT EXISTS idx_exp_runs_variant ON experiment_runs(variant_id);
  `);
}

// --- Core API Functions ---

/**
 * Create a new A/B testing experiment.
 * 
 * @param agentId - The agent to run experiments on
 * @param variants - Array of workflow variants to test
 * @param options - Experiment configuration
 * @returns The created experiment with variant IDs
 * 
 * Example:
 * ```ts
 * const experiment = await createExperiment("my-agent", [
 *   {
 *     name: "Control",
 *     description: "Current workflow",
 *     modifications: []
 *   },
 *   {
 *     name: "Better Prompt",
 *     description: "Improved LLM prompt with more context",
 *     modifications: [
 *       { type: "step-modify", target: "analyze", value: { prompt: "..." }, reason: "More specific instructions" }
 *     ]
 *   }
 * ], {
 *   name: "Prompt Quality Test",
 *   hypothesis: "More detailed prompts improve accuracy",
 *   successMetric: "success_rate"
 * });
 * ```
 */
export async function createExperiment(
  agentId: string,
  variants: Array<{
    name: string;
    description?: string;
    configOverrides?: Record<string, any>;
    modifications?: WorkflowModification[];
  }>,
  options: {
    name?: string;
    description?: string;
    hypothesis?: string;
    successMetric?: string;
    minRunsPerVariant?: number;
    baseWorkflowPath?: string;
  } = {}
): Promise<Experiment & { variants: ExperimentVariant[] }> {
  initExperimentTables();
  const db = getDb();

  // Get agent's workflow path if not provided
  let baseWorkflowPath = options.baseWorkflowPath;
  if (!baseWorkflowPath) {
    const { getAgent } = await import("../../agents-core/db.js");
    const agent = getAgent(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    baseWorkflowPath = agent.workflow_path;
  }
  
  if (!baseWorkflowPath) {
    throw new Error(`No workflow path available for agent ${agentId}`);
  }

  const experimentId = `exp-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  
  // Create experiment
  db.prepare(`
    INSERT INTO experiments (id, agent_id, name, description, base_workflow_path, status, hypothesis, success_metric, min_runs_per_variant)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(
    experimentId,
    agentId,
    options.name || `Experiment ${experimentId.slice(-6)}`,
    options.description || null,
    baseWorkflowPath,
    options.hypothesis || null,
    options.successMetric || "success_rate",
    options.minRunsPerVariant || 10
  );

  // Create control variant (baseline) if not explicitly provided
  const hasControl = variants.some(v => v.name.toLowerCase() === "control" || v.modifications?.length === 0);
  const allVariants = hasControl ? variants : [
    { name: "Control", description: "Baseline workflow (no changes)", modifications: [] },
    ...variants
  ];

  // Create variant records
  const createdVariants: ExperimentVariant[] = [];
  for (const variant of allVariants) {
    const variantId = `var-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    
    db.prepare(`
      INSERT INTO experiment_variants (id, experiment_id, name, description, config_overrides, workflow_modifications)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      variantId,
      experimentId,
      variant.name,
      variant.description || null,
      JSON.stringify(variant.configOverrides || {}),
      JSON.stringify(variant.modifications || [])
    );

    createdVariants.push({
      id: variantId,
      experimentId,
      name: variant.name,
      description: variant.description || "",
      configOverrides: variant.configOverrides || {},
      workflowModifications: variant.modifications || [],
      runCount: 0,
      createdAt: new Date().toISOString(),
    });
  }

  const experiment: Experiment = {
    id: experimentId,
    agentId,
    name: options.name || `Experiment ${experimentId.slice(-6)}`,
    description: options.description || "",
    baseWorkflowPath,
    status: "draft",
    hypothesis: options.hypothesis || "",
    successMetric: options.successMetric || "success_rate",
    minRunsPerVariant: options.minRunsPerVariant || 10,
    createdAt: new Date().toISOString(),
  };

  return { ...experiment, variants: createdVariants };
}

/**
 * Run a single variant and record results.
 * 
 * @param variantId - The variant to run
 * @param workflow - The workflow definition (can be modified from base)
 * @param options - Run options
 * @returns The experiment run record with metrics
 * 
 * Example:
 * ```ts
 * const run = await runVariant(variantId, workflow, {
 *   inputData: { query: "test" }
 * });
 * ```
 */
export async function runVariant(
  variantId: string,
  workflow: WorkflowDefinition,
  options: {
    inputData?: Record<string, any>;
    onProgress?: (step: string, status: string) => void;
    customMetrics?: Record<string, number>;
  } = {}
): Promise<ExperimentRun> {
  initExperimentTables();
  const db = getDb();

  // Get variant and experiment info
  const variant = db.prepare(`
    SELECT v.*, e.agent_id, e.experiment_id, e.id as exp_id
    FROM experiment_variants v
    JOIN experiments e ON v.experiment_id = e.id
    WHERE v.id = ?
  `).get(variantId) as any;

  if (!variant) throw new Error(`Variant ${variantId} not found`);

  const experimentRunId = `er-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  
  // Create experiment run record
  db.prepare(`
    INSERT INTO experiment_runs (id, experiment_id, variant_id, run_id, status, started_at)
    VALUES (?, ?, ?, ?, 'running', datetime('now'))
  `).run(experimentRunId, variant.exp_id, variantId, ""); // run_id will be updated after workflow run

  const startTime = Date.now();
  
  try {
    // Merge input data into workflow config
    const configOverrides = {
      ...JSON.parse(variant.config_overrides || "{}"),
      ...options.inputData,
    };

    // Execute workflow
    const result = await executeWorkflow(
      workflow,
      variant.agent_id,
      configOverrides,
      options.onProgress
    );

    const durationMs = Date.now() - startTime;
    const runId = result.runId || "";

    // Calculate metrics
    const metrics: ExperimentMetrics = {
      durationMs,
      success: result.success,
      tokenCount: 0, // Will be populated from steps
      stepCount: 0,
      error: result.error,
      customMetrics: options.customMetrics,
    };

    // Get step info for detailed metrics
    if (runId) {
      const { getSteps } = await import("../../agents-core/db.js");
      const steps = getSteps(runId);
      metrics.stepCount = steps.length;
      metrics.tokenCount = steps.reduce((sum: number, s: { tokens_used?: number }) => sum + (s.tokens_used || 0), 0);
    }

    // Update experiment run record
    db.prepare(`
      UPDATE experiment_runs
      SET run_id = ?, status = ?, duration_ms = ?, success = ?, token_count = ?, step_count = ?, error = ?, custom_metrics = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(
      runId,
      result.success ? "completed" : "failed",
      metrics.durationMs,
      result.success ? 1 : 0,
      metrics.tokenCount,
      metrics.stepCount,
      metrics.error || null,
      JSON.stringify(metrics.customMetrics || {}),
      experimentRunId
    );

    // Update variant run count
    db.prepare(`
      UPDATE experiment_variants SET run_count = run_count + 1 WHERE id = ?
    `).run(variantId);

    return {
      id: experimentRunId,
      experimentId: variant.exp_id,
      variantId,
      runId,
      status: result.success ? "completed" : "failed",
      metrics,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };

  } catch (err) {
    const durationMs = Date.now() - startTime;
    const error = err instanceof Error ? err.message : String(err);

    // Record failure
    db.prepare(`
      UPDATE experiment_runs
      SET status = ?, duration_ms = ?, success = 0, error = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run("failed", durationMs, error, experimentRunId);

    return {
      id: experimentRunId,
      experimentId: variant.exp_id,
      variantId,
      runId: "",
      status: "failed",
      metrics: {
        durationMs,
        success: false,
        tokenCount: 0,
        stepCount: 0,
        error,
      },
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Run all variants in an experiment for a specified number of iterations.
 * 
 * @param experimentId - The experiment to run
 * @param iterations - Number of runs per variant
 * @param inputGenerator - Function to generate input data for each run
 * @returns Summary of all runs
 */
export async function runExperiment(
  experimentId: string,
  iterations: number = 1,
  inputGenerator?: (variantIndex: number, runIndex: number) => Record<string, any>
): Promise<{ experiment: Experiment; runs: ExperimentRun[] }> {
  initExperimentTables();
  const db = getDb();

  // Get experiment and variants
  const experiment = db.prepare("SELECT * FROM experiments WHERE id = ?").get(experimentId) as any;
  if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

  const variants = db.prepare("SELECT * FROM experiment_variants WHERE experiment_id = ?").all(experimentId) as any[];
  if (variants.length === 0) throw new Error(`No variants found for experiment ${experimentId}`);

  // Load base workflow
  const { parseWorkflow } = await import("../../agents-core/workflow.js");
  const baseWorkflow = parseWorkflow(experiment.base_workflow_path);

  // Update experiment status
  db.prepare("UPDATE experiments SET status = 'running' WHERE id = ?").run(experimentId);

  const allRuns: ExperimentRun[] = [];

  try {
    for (let i = 0; i < iterations; i++) {
      for (let v = 0; v < variants.length; v++) {
        const variant = variants[v];
        
        // Build workflow with modifications
        const variantWorkflow = applyWorkflowModifications(
          baseWorkflow,
          JSON.parse(variant.workflow_modifications || "[]")
        );

        // Generate input data
        const inputData = inputGenerator ? inputGenerator(v, i) : {};

        // Run variant
        const run = await runVariant(variant.id, variantWorkflow, { inputData });
        allRuns.push(run);
      }
    }

    // Check if we've reached minimum runs
    const runsPerVariant = new Map<string, number>();
    for (const run of allRuns) {
      runsPerVariant.set(run.variantId, (runsPerVariant.get(run.variantId) || 0) + 1);
    }
    
    const minRuns = Math.min(...variants.map(v => runsPerVariant.get(v.id) || 0));
    const hasEnoughRuns = minRuns >= experiment.min_runs_per_variant;

    if (hasEnoughRuns) {
      db.prepare("UPDATE experiments SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(experimentId);
    }

  } catch (err) {
    db.prepare("UPDATE experiments SET status = 'cancelled' WHERE id = ?").run(experimentId);
    throw err;
  }

  return {
    experiment: {
      id: experiment.id,
      agentId: experiment.agent_id,
      name: experiment.name,
      description: experiment.description || "",
      baseWorkflowPath: experiment.base_workflow_path,
      status: "completed",
      hypothesis: experiment.hypothesis || "",
      successMetric: experiment.success_metric,
      minRunsPerVariant: experiment.min_runs_per_variant,
      createdAt: experiment.created_at,
      completedAt: new Date().toISOString(),
    },
    runs: allRuns,
  };
}

/**
 * Compare results across all variants in an experiment.
 * 
 * @param experimentId - The experiment to analyze
 * @returns Statistical comparison with winner recommendation
 * 
 * Example:
 * ```ts
 * const comparison = await compareResults("exp-abc123");
 * console.log(comparison.winner); // Best performing variant
 * console.log(comparison.statisticalSignificance); // true if results are significant
 * ```
 */
export async function compareResults(experimentId: string): Promise<ComparisonResult> {
  initExperimentTables();
  const db = getDb();

  // Get experiment
  const experimentRow = db.prepare("SELECT * FROM experiments WHERE id = ?").get(experimentId) as any;
  if (!experimentRow) throw new Error(`Experiment ${experimentId} not found`);

  // Get variants with runs
  const variantRows = db.prepare(`
    SELECT v.*, 
      COUNT(r.id) as total_runs,
      SUM(CASE WHEN r.success = 1 THEN 1 ELSE 0 END) as success_count,
      AVG(r.duration_ms) as avg_duration,
      AVG(r.token_count) as avg_tokens,
      AVG(CASE WHEN r.success = 1 THEN 1 ELSE 0 END) as success_rate
    FROM experiment_variants v
    LEFT JOIN experiment_runs r ON v.id = r.variant_id AND r.status = 'completed'
    WHERE v.experiment_id = ?
    GROUP BY v.id
  `).all(experimentId) as any[];

  // Load detailed runs for each variant
  const variantResults: VariantResult[] = [];
  
  for (const v of variantRows) {
    const runs = db.prepare(`
      SELECT * FROM experiment_runs 
      WHERE variant_id = ? AND status = 'completed'
      ORDER BY started_at DESC
    `).all(v.id) as any[];

    const experimentRuns: ExperimentRun[] = runs.map(r => ({
      id: r.id,
      experimentId: r.experiment_id,
      variantId: r.variant_id,
      runId: r.run_id,
      status: r.status,
      metrics: {
        durationMs: r.duration_ms,
        success: r.success === 1,
        tokenCount: r.token_count,
        stepCount: r.step_count,
        error: r.error,
        customMetrics: JSON.parse(r.custom_metrics || "{}"),
      },
      startedAt: r.started_at,
      completedAt: r.completed_at,
    }));

    // Calculate statistics
    const aggregated = calculateAggregatedMetrics(experimentRuns, experimentRow.success_metric);

    variantResults.push({
      variant: {
        id: v.id,
        experimentId,
        name: v.name,
        description: v.description || "",
        configOverrides: JSON.parse(v.config_overrides || "{}"),
        workflowModifications: JSON.parse(v.workflow_modifications || "[]"),
        runCount: v.total_runs,
        createdAt: v.created_at,
      },
      runs: experimentRuns,
      aggregated,
    });
  }

  // Statistical comparison
  const controlResult = variantResults.find(v => v.variant.name.toLowerCase() === "control") || variantResults[0];
  const treatmentResults = variantResults.filter(v => v.variant.id !== controlResult?.variant.id);

  // Determine winner based on success metric
  let winner: ComparisonResult["winner"] = null;
  let statisticalSignificance = false;
  let recommendation = "Insufficient data for recommendation";

  if (variantResults.length >= 2 && controlResult) {
    const controlRate = controlResult.aggregated.successRate;
    const controlCI = controlResult.aggregated.confidenceInterval.successRate;

    // Find best treatment
    let bestTreatment: VariantResult | null = null;
    let bestLift = 0;

    for (const treatment of treatmentResults) {
      const treatmentRate = treatment.aggregated.successRate;
      const treatmentCI = treatment.aggregated.confidenceInterval.successRate;
      const lift = treatmentRate - controlRate;
      
      // Check for statistical significance (confidence intervals don't overlap)
      const significant = 
        (treatmentRate > controlRate && treatmentCI[0] > controlCI[1]) ||
        (treatmentRate < controlRate && treatmentCI[1] < controlCI[0]);

      if (significant && Math.abs(lift) > Math.abs(bestLift)) {
        bestLift = lift;
        bestTreatment = treatment;
        statisticalSignificance = true;
      }
    }

    if (bestTreatment) {
      const liftPercent = (bestLift * 100).toFixed(1);
      winner = {
        variantId: bestTreatment.variant.id,
        variantName: bestTreatment.variant.name,
        confidence: bestTreatment.aggregated.confidenceInterval.successRate[0] - controlResult.aggregated.confidenceInterval.successRate[1],
        reason: `${liftPercent}% improvement in ${experimentRow.success_metric} over control (${(bestTreatment.aggregated.successRate * 100).toFixed(1)}% vs ${(controlRate * 100).toFixed(1)}%)`,
      };
      recommendation = `Deploy variant "${bestTreatment.variant.name}" - statistically significant ${liftPercent}% improvement`;
    } else if (controlResult.aggregated.totalRuns >= experimentRow.min_runs_per_variant) {
      recommendation = "No statistically significant improvement found. Keep control variant.";
    } else {
      recommendation = `Need ${experimentRow.min_runs_per_variant - controlResult.aggregated.totalRuns} more runs for statistical significance`;
    }
  }

  const experiment: Experiment = {
    id: experimentRow.id,
    agentId: experimentRow.agent_id,
    name: experimentRow.name,
    description: experimentRow.description || "",
    baseWorkflowPath: experimentRow.base_workflow_path,
    status: experimentRow.status,
    hypothesis: experimentRow.hypothesis || "",
    successMetric: experimentRow.success_metric,
    minRunsPerVariant: experimentRow.min_runs_per_variant,
    createdAt: experimentRow.created_at,
    completedAt: experimentRow.completed_at,
  };

  return {
    experiment,
    variants: variantResults,
    winner,
    statisticalSignificance,
    recommendation,
  };
}

// --- Helper Functions ---

/**
 * Apply workflow modifications to create a variant workflow.
 */
function applyWorkflowModifications(
  baseWorkflow: WorkflowDefinition,
  modifications: WorkflowModification[]
): WorkflowDefinition {
  // Deep clone the workflow
  const workflow: WorkflowDefinition = JSON.parse(JSON.stringify(baseWorkflow));

  for (const mod of modifications) {
    switch (mod.type) {
      case "step-modify": {
        const stepIndex = workflow.steps.findIndex((s: WorkflowStep) => s.name === mod.target);
        if (stepIndex >= 0) {
          workflow.steps[stepIndex] = { ...workflow.steps[stepIndex], ...mod.value };
        }
        break;
      }
      case "step-add": {
        const insertIndex = workflow.steps.findIndex((s: WorkflowStep) => s.name === mod.target);
        if (insertIndex >= 0) {
          workflow.steps.splice(insertIndex, 0, mod.value);
        } else {
          workflow.steps.push(mod.value);
        }
        break;
      }
      case "step-remove": {
        workflow.steps = workflow.steps.filter((s: WorkflowStep) => s.name !== mod.target);
        break;
      }
      case "step-replace": {
        const replaceIndex = workflow.steps.findIndex((s: WorkflowStep) => s.name === mod.target);
        if (replaceIndex >= 0) {
          workflow.steps[replaceIndex] = mod.value;
        }
        break;
      }
      case "config-override": {
        workflow.config = { ...workflow.config, [mod.target]: mod.value };
        break;
      }
    }
  }

  return workflow;
}

/**
 * Calculate aggregated metrics with confidence intervals.
 */
function calculateAggregatedMetrics(runs: ExperimentRun[], metric: string): AggregatedMetrics {
  const totalRuns = runs.length;
  const successCount = runs.filter(r => r.metrics.success).length;
  const successRate = totalRuns > 0 ? successCount / totalRuns : 0;

  const durations = runs.map(r => r.metrics.durationMs);
  const tokens = runs.map(r => r.metrics.tokenCount);

  const avgDurationMs = totalRuns > 0 ? durations.reduce((a, b) => a + b, 0) / totalRuns : 0;
  const avgTokenCount = totalRuns > 0 ? tokens.reduce((a, b) => a + b, 0) / totalRuns : 0;

  const stdDurationMs = calculateStandardDeviation(durations);
  const stdTokenCount = calculateStandardDeviation(tokens);

  // 95% confidence interval using normal approximation
  const z95 = 1.96;
  const successRateSE = totalRuns > 0 ? Math.sqrt(successRate * (1 - successRate) / totalRuns) : 0;
  const durationSE = totalRuns > 0 ? stdDurationMs / Math.sqrt(totalRuns) : 0;

  return {
    totalRuns,
    successCount,
    successRate,
    avgDurationMs,
    avgTokenCount,
    stdDurationMs,
    stdTokenCount,
    confidenceInterval: {
      successRate: [
        Math.max(0, successRate - z95 * successRateSE),
        Math.min(1, successRate + z95 * successRateSE),
      ],
      avgDurationMs: [
        Math.max(0, avgDurationMs - z95 * durationSE),
        avgDurationMs + z95 * durationSE,
      ],
    },
  };
}

function calculateStandardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// --- List/Query Functions ---

/**
 * List all experiments for an agent.
 */
export function listExperiments(agentId?: string): Experiment[] {
  initExperimentTables();
  const db = getDb();

  let query = "SELECT * FROM experiments ORDER BY created_at DESC";
  let params: any[] = [];

  if (agentId) {
    query = "SELECT * FROM experiments WHERE agent_id = ? ORDER BY created_at DESC";
    params = [agentId];
  }

  const rows = db.prepare(query).all(...params) as any[];

  return rows.map(r => ({
    id: r.id,
    agentId: r.agent_id,
    name: r.name,
    description: r.description || "",
    baseWorkflowPath: r.base_workflow_path,
    status: r.status,
    hypothesis: r.hypothesis || "",
    successMetric: r.success_metric,
    minRunsPerVariant: r.min_runs_per_variant,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  }));
}

/**
 * Get experiment details with all variants.
 */
export function getExperiment(experimentId: string): (Experiment & { variants: ExperimentVariant[] }) | null {
  initExperimentTables();
  const db = getDb();

  const experiment = db.prepare("SELECT * FROM experiments WHERE id = ?").get(experimentId) as any;
  if (!experiment) return null;

  const variants = db.prepare("SELECT * FROM experiment_variants WHERE experiment_id = ?").all(experimentId) as any[];

  return {
    id: experiment.id,
    agentId: experiment.agent_id,
    name: experiment.name,
    description: experiment.description || "",
    baseWorkflowPath: experiment.base_workflow_path,
    status: experiment.status,
    hypothesis: experiment.hypothesis || "",
    successMetric: experiment.success_metric,
    minRunsPerVariant: experiment.min_runs_per_variant,
    createdAt: experiment.created_at,
    completedAt: experiment.completed_at,
    variants: variants.map(v => ({
      id: v.id,
      experimentId: v.experiment_id,
      name: v.name,
      description: v.description || "",
      configOverrides: JSON.parse(v.config_overrides || "{}"),
      workflowModifications: JSON.parse(v.workflow_modifications || "[]"),
      runCount: v.run_count,
      createdAt: v.created_at,
    })),
  };
}

/**
 * Delete an experiment and all its data.
 */
export function deleteExperiment(experimentId: string): void {
  initExperimentTables();
  const db = getDb();
  db.prepare("DELETE FROM experiments WHERE id = ?").run(experimentId);
  // Cascading deletes handle variants and runs
}

/**
 * Export experiment results as CSV for external analysis.
 */
export function exportExperimentResults(experimentId: string): string {
  initExperimentTables();
  const db = getDb();

  const runs = db.prepare(`
    SELECT e.name as experiment_name, v.name as variant_name, r.*
    FROM experiment_runs r
    JOIN experiments e ON r.experiment_id = e.id
    JOIN experiment_variants v ON r.variant_id = v.id
    WHERE r.experiment_id = ?
    ORDER BY v.name, r.started_at
  `).all(experimentId) as any[];

  if (runs.length === 0) return "";

  const headers = ["experiment_name", "variant_name", "run_id", "status", "success", "duration_ms", "token_count", "step_count", "error", "started_at", "completed_at"];
  const csv = [
    headers.join(","),
    ...runs.map(r => [
      r.experiment_name,
      r.variant_name,
      r.run_id,
      r.status,
      r.success,
      r.duration_ms,
      r.token_count,
      r.step_count,
      r.error ? `"${r.error.replace(/"/g, '""')}"` : "",
      r.started_at,
      r.completed_at,
    ].join(","))
  ].join("\n");

  return csv;
}
