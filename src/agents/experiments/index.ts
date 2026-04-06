/**
 * Experiments Module - A/B Testing Framework for Agent Workflows
 * 
 * This module provides a complete A/B testing framework for comparing
 * workflow variants and making data-driven improvements.
 * 
 * Core Functions:
 * - createExperiment: Create a new A/B test with workflow variants
 * - runVariant: Execute a single variant and record metrics
 * - runExperiment: Run all variants for multiple iterations
 * - compareResults: Statistical comparison with winner recommendation
 * 
 * Utility Functions:
 * - listExperiments: List all experiments for an agent
 * - getExperiment: Get experiment details with variants
 * - deleteExperiment: Remove experiment and its data
 * - exportExperimentResults: Export to CSV for analysis
 * 
 * Database Functions:
 * - initExperimentTables: Initialize SQLite schema
 */

export {
  // Core API
  createExperiment,
  runVariant,
  runExperiment,
  compareResults,
  
  // Database
  initExperimentTables,
  
  // Query/Export
  listExperiments,
  getExperiment,
  deleteExperiment,
  exportExperimentResults,
} from "./framework.js";

// Re-export types
export type {
  Experiment,
  ExperimentVariant,
  ExperimentRun,
  ExperimentMetrics,
  WorkflowModification,
  VariantResult,
  AggregatedMetrics,
  ComparisonResult,
} from "./framework.js";
