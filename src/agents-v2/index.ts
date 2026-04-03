/**
 * Kai Agent System v2
 * 
 * Event-driven, durable, autonomous agent system.
 * 
 * Architecture:
 * - Event Bus: In-process pub/sub for triggers
 * - Durable Runner: Checkpoint/resume for crash recovery
 * - Orchestrator: Goal decomposition and coordination
 * - Templates: Dynamic agent spawning
 * - Meta-Learner: Self-improvement through analysis
 * - A/B Testing: Compare workflow variants with statistical rigor
 */

export { eventBus, EventBus } from "./event-bus.js";
export type { 
  AgentEvent, 
  EventType, 
  EventHandler, 
  EventFilter, 
  TriggerConfig as EventTriggerConfig, 
  AgentRegistration 
} from "./types.js";

// Watchers
export { 
  watchFile, 
  unwatchFile, 
  unwatchAll, 
  getWatchedFiles 
} from "./watchers/file.js";

export { 
  startEmailWatcher, 
  stopEmailWatcher 
} from "./watchers/email.js";

// Scheduler & Runner
export { 
  registerAgentTriggers, 
  unregisterAgentTriggers, 
  convertHeartbeatToTriggers 
} from "./scheduler.js";

export { runAgent, loadWorkflow } from "./runner.js";

// Durable execution
export { 
  runDurable, 
  resumeRun, 
  recoverInterruptedRuns,
  recoverAll,
  findInterruptedRunsForDisplay,
  getResumeStatus,
} from "./runner-durable.js";

export { 
  saveCheckpoint, 
  getLatestCheckpoint 
} from "./checkpoint.js";

// Goal Orchestration
export {
  createGoal,
  decomposeGoal,
  orchestrateGoal,
  type Goal,
  type SubGoal,
} from "./orchestrator.js";

// Templates
export {
  registerTemplate,
  getTemplate,
  listTemplates,
  spawnFromTemplate,
  type AgentTemplate,
} from "./templates.js";

// Meta-Learning
export {
  analyzeAgent,
  applyImprovements,
  runMetaLearning,
  type RunAnalysis,
  type WorkflowSuggestion,
} from "./meta-learner.js";

// Optimization Trigger System
export {
  checkOptimizationNeeded,
  triggerOptimization,
  getOptimizationStatus,
  listActiveOptimizations,
  clearCompletedOptimizations,
  runGlobalOptimizationCheck,
  enableAutoOptimization,
  createAgentTriggerConfig,
  DEFAULT_TRIGGER_CONFIG,
  type OptimizationCheckResult,
  type OptimizationFactor,
  type TriggeredOptimization,
  type PatternAnalysisReport,
  type DetectedPattern,
  type TriggerConfig,
} from "./optimization/trigger-system.js";

// A/B Testing Framework
export {
  createExperiment,
  runVariant,
  runExperiment,
  compareResults,
  listExperiments,
  getExperiment,
  deleteExperiment,
  exportExperimentResults,
  initExperimentTables,
  type Experiment,
  type ExperimentVariant,
  type ExperimentRun,
  type ExperimentMetrics,
  type WorkflowModification,
  type VariantResult,
  type AggregatedMetrics,
  type ComparisonResult,
} from "./experiments/index.js";
