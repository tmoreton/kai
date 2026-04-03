# Kai Agent System v2 - Complete Reference

## System Overview

Kai Agent System v2 is a production-ready autonomous agent platform with three integrated capabilities:

1. **Skills Infrastructure** - Modular, hot-reloadable integrations
2. **Durable Execution** - Crash recovery with step-level checkpointing  
3. **Self-Improvement Loop** - Pattern analysis, A/B testing, auto-optimization

---

## Quick Start

### Start the Daemon (Recommended)
```bash
kai agent daemon
```
This runs all scheduled agents with auto-recovery from crashes.

### Run an Agent Manually
```bash
kai agent run yt-scout
```

### Resume After Crash
```bash
kai agent list-interrupted          # See what's interrupted
kai agent resume <run-id>           # Resume specific run
```

### Analyze & Improve
```bash
kai agent optimize yt-scout         # Get improvement suggestions
kai agent create-variant yt-scout v2  # Create A/B test variant
kai agent experiments yt-scout      # View experiment results
```

---

## Architecture

### Three-Layer System

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI / Web UI                            │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                    Agent System v2                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   Skills     │  │   Durable    │  │ Self-Improve │        │
│  │   System     │◄─┤  Execution   │◄─┤    Loop      │        │
│  │              │  │              │  │              │        │
│  │ • data       │  │ • Checkpoints│  │ • Patterns   │        │
│  │ • youtube    │  │ • Resume     │  │ • A/B Tests  │        │
│  │ • browser    │  │ • Recovery   │  │ • Triggers   │        │
│  │ • email      │  │              │  │              │        │
│  │ • web-tools  │  │              │  │              │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│           │                                    │             │
│           └────────────────┬───────────────────┘             │
│                            │                                 │
│                     ┌──────▼──────┐                          │
│                     │   SQLite    │                          │
│                     │   (agents,  │                          │
│                     │   runs,     │                          │
│                     │   metrics)  │                          │
│                     └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Skills Infrastructure

### Available Skills

| Skill | ID | Capabilities |
|-------|-----|--------------|
| Data | `data` | read_json, write_json, read_markdown, write_markdown, read_text, write_text |
| YouTube | `youtube` | search_videos, get_video_stats, get_channel, get_recent_uploads, get_trending |
| Browser | `browser` | open, click, fill, screenshot, evaluate |
| Email | `email` | send, read, search |
| Web Tools | `web-tools` | fetch, search |

### Skill Directory Structure
```
~/.kai/skills/
├── builtin-data/
│   ├── skill.yaml      # Manifest (id, name, tools, config)
│   └── handler.js      # Implementation (actions export)
├── builtin-youtube/
│   ├── skill.yaml
│   └── handler.js
└── ...
```

### Using Skills in Workflows

```yaml
name: my-workflow
steps:
  # Old way (deprecated)
  - name: old-step
    type: integration
    integration: data
    action: write_json
    
  # New way (recommended)
  - name: new-step
    type: skill
    skill: data
    action: write_json
    params:
      file_path: "/tmp/output.json"
      data: "${vars.result}"
```

### Loading Skills Programmatically

```typescript
import { loadAllSkills, getSkill } from "./skills/loader.js";

await loadAllSkills();
const dataSkill = getSkill("data");
const result = await dataSkill.handler.actions.write_json({
  file_path: "/tmp/test.json",
  data: { key: "value" }
});
```

---

## Phase 2: Durable Execution

### How It Works

1. **Before each step**: Full context saved to checkpoint (config, vars, env, step index)
2. **On crash**: Resume from last checkpoint with exact state
3. **No re-execution**: Completed steps are skipped

### Checkpoint Flow

```
Start Workflow
    ↓
Create Run Record
    ↓
For Each Step:
    ├─ Save Checkpoint (config, vars, step_index)
    ├─ Execute Step
    └─ Store Result
    ↓
If Crash:
    └─ Resume from Checkpoint
    ↓
On Success:
    └─ Cleanup Old Checkpoints
```

### API

```typescript
// Execute with checkpointing
import { executeWorkflow } from "./agents/workflow.js";

const result = await executeWorkflow(
  workflow,
  agentId,
  {}, // config overrides
  (step, status) => console.log(`${step}: ${status}`), // progress callback
  { resumeFrom: "run-xxx" } // optional: resume from checkpoint
);

// Resume manually
import { resumeRun } from "./agents/resume.js";
const result = await resumeRun(runId);

// Find interrupted runs
import { findInterruptedRuns } from "./agents/resume.js";
const interrupted = findInterruptedRuns();

// Auto-recover all
import { recoverAll } from "./agents/resume.js";
const { recovered, failed } = await recoverAll();
```

### Checkpoint Data Structure

```typescript
interface Checkpoint {
  id: number;
  runId: string;
  stepIndex: number;  // Next step to execute
  context: string;    // JSON: { config, vars, env, agent_id, run_id }
  createdAt: string;
}
```

### CLI Commands

```bash
# Resume a specific run
kai agent resume run-abc123

# List all interrupted runs
kai agent list-interrupted

# Daemon auto-recovers on startup
kai agent daemon
```

---

## Phase 3: Self-Improvement Loop

### Pattern Analysis

Analyzes agent run history to detect patterns in success/failure.

```typescript
import { analyzeAgentPerformance } from "./agents-v2/analysis/pattern-analyzer.js";

const analysis = analyzeAgentPerformance("yt-scout");
// Returns:
{
  successRate: 0.85,
  commonErrors: [
    { type: "API_TIMEOUT", count: 5, percentageOfFailures: 0.62, suggestions: [...] }
  ],
  patterns: [
    { id: "high-step-count", type: "warning", description: "...", confidence: 0.85 }
  ],
  recommendations: [
    { 
      priority: "high", 
      category: "error_handling", 
      title: "Add retry logic",
      expectedImpact: "25% reduction in failures"
    }
  ]
}
```

### A/B Testing Framework

Create and run workflow variants to compare performance.

```typescript
import { 
  createExperiment, 
  runVariant, 
  compareResults,
  listExperiments 
} from "./agents-v2/experiments/framework.js";

// Create experiment with variants
const experiment = await createExperiment("yt-scout", [
  {
    name: "shorter-prompt",
    description: "Reduce prompt length by 30%",
    workflowPath: "/path/to/variant-a.yaml",
    modifications: [
      { stepName: "analyze", field: "max_tokens", newValue: 2000 }
    ]
  },
  {
    name: "longer-prompt",
    description: "Increase prompt detail",
    workflowPath: "/path/to/variant-b.yaml",
    modifications: [
      { stepName: "analyze", field: "max_tokens", newValue: 4000 }
    ]
  }
]);

// Run variants
for (const variant of experiment.variants) {
  await runVariant(variant.id, workflow);
}

// Compare results
const comparison = await compareResults(experiment.id);
// Returns winner, statistical significance, improvement metrics
```

### Optimization Triggers

Automatic detection and triggering of optimization cycles.

```typescript
import { 
  checkOptimizationNeeded, 
  triggerOptimization,
  enableAutoOptimization 
} from "./agents-v2/optimization/trigger-system.js";

// Check if optimization needed
const check = checkOptimizationNeeded("yt-scout");
// Returns: { needsOptimization: true, reason: "Success rate below 80%", confidence: 0.85 }

// Trigger optimization manually
const result = await triggerOptimization("yt-scout");
// Returns optimization report with suggestions

// Enable auto-optimization
const disable = enableAutoOptimization({
  enabled: true,
  autoTriggerThresholds: {
    maxAcceptableFailureRate: 0.2,
    minAcceptableSuccessRate: 0.8
  }
});
// Automatically triggers optimization when thresholds breached
```

### Metrics Storage

All metrics stored in SQLite for analysis.

```typescript
import { 
  saveRunMetrics, 
  saveStepMetrics,
  getRunMetrics,
  getStepMetrics 
} from "./agents-v2/metrics/storage.js";

// Save metrics
saveRunMetrics({
  runId: "run-xxx",
  agentId: "yt-scout",
  status: "completed",
  totalDurationMs: 15000,
  successRate: 1.0,
  // ... more fields
});

// Retrieve metrics
const metrics = getRunMetrics("run-xxx");
const steps = getStepMetrics("run-xxx");
```

### CLI Commands

```bash
# Analyze agent and get suggestions
kai agent optimize yt-scout

# List experiments for agent
kai agent experiments yt-scout

# Create variant
kai agent create-variant yt-scout v2-shorter-prompt

# Edit the variant workflow, then run both to compare
```

---

## Workflow YAML Format

### Complete Example

```yaml
name: YouTube Content Scout
description: Monitors competitors and builds intel feed

# Schedule (cron format)
schedule: "0 */6 * * *"  # Every 6 hours

# Review loop for quality
review:
  enabled: true
  max_iterations: 2
  review_prompt: |
    Does the analysis reference actual video titles?
    Are patterns specific, not generic?
  improve_steps:
    - analyze_content

# Configuration available in steps as ${config.key}
config:
  my_channel_id: "UCC8yAE278hIstZpHiC0VBLg"
  search_keywords:
    - "build in public"
    - "AI coding"

# Workflow steps
steps:
  # LLM step
  - name: analyze_trends
    type: llm
    prompt: |
      Analyze these trending topics for ${config.my_channel_id}:
      ${vars.raw_data}
      
      Identify patterns in successful videos.
    max_tokens: 2000
    output_var: analysis
    
  # Skill step (NEW - recommended)
  - name: save_results
    type: skill
    skill: data
    action: write_json
    params:
      file_path: "/tmp/analysis.json"
      data: "${vars.analysis}"
    output_var: save_result
    
  # Deprecated but still works
  - name: old_way
    type: integration
    integration: data
    action: write_json
    params:
      file_path: "/tmp/old.json"
      data: "${vars.analysis}"
    
  # Shell step
  - name: notify
    type: shell
    command: "echo 'Analysis complete: ${vars.save_result}'"
    output_var: notification
    
  # Conditional step
  - name: error_handler
    type: llm
    prompt: "Handle error: ${vars.error}"
    condition: "${vars.error}"  # Only runs if error exists
```

### Step Types

| Type | Purpose | Key Fields |
|------|---------|------------|
| `llm` | AI language model | `prompt`, `max_tokens`, `output_var` |
| `skill` | Execute skill tool | `skill`, `action`, `params`, `output_var` |
| `shell` | Run shell command | `command`, `output_var` |
| `notify` | Show notification | `prompt` |
| `review` | Quality review | Uses review config |
| `parallel` | Run steps in parallel | `steps` array |
| `approval` | Human approval gate | `auto_approve` |

### Variable Interpolation

```yaml
steps:
  - name: example
    type: skill
    params:
      # Config values: ${config.key}
      file_path: "/tmp/${config.agent_name}.json"
      
      # Step outputs: ${vars.step_name}
      data: "${vars.previous_result}"
      
      # Environment: ${env.VAR_NAME}
      api_key: "${env.YOUTUBE_API_KEY}"
```

---

## Database Schema

### Core Tables

```sql
-- Agents
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  workflow_path TEXT,
  schedule TEXT,
  enabled INTEGER DEFAULT 1,
  config TEXT,  -- JSON
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Runs
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id),
  status TEXT,  -- 'running', 'completed', 'failed', 'paused'
  trigger TEXT,
  current_step INTEGER DEFAULT 0,
  error TEXT,
  recap TEXT,
  started_at TEXT,
  completed_at TEXT
);

-- Steps
CREATE TABLE steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT REFERENCES runs(id),
  step_name TEXT,
  step_index INTEGER,
  status TEXT,  -- 'running', 'completed', 'failed', 'skipped'
  output TEXT,
  error TEXT,
  tokens_used INTEGER,
  started_at TEXT,
  completed_at TEXT
);

-- Checkpoints (for durable execution)
CREATE TABLE checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  step_index INTEGER,
  context TEXT,  -- JSON: { config, vars, env, ... }
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Experiments
CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  name TEXT,
  description TEXT,
  base_workflow_path TEXT,
  status TEXT,  -- 'draft', 'running', 'completed'
  created_at TEXT
);

-- Experiment Variants
CREATE TABLE experiment_variants (
  id TEXT PRIMARY KEY,
  experiment_id TEXT,
  name TEXT,
  description TEXT,
  workflow_path TEXT,
  modifications TEXT  -- JSON
);

-- Experiment Runs
CREATE TABLE experiment_runs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT,
  variant_id TEXT,
  agent_id TEXT,
  run_id TEXT,
  status TEXT,
  duration_ms INTEGER,
  success INTEGER,
  custom_metrics TEXT  -- JSON
);
```

---

## Migration Guide

### From Integration to Skill

**Old format (deprecated):**
```yaml
steps:
  - name: save
    type: integration
    integration: data
    action: write_json
    params:
      file_path: "/tmp/data.json"
```

**New format (recommended):**
```yaml
steps:
  - name: save
    type: skill
    skill: data
    action: write_json
    params:
      file_path: "/tmp/data.json"
```

### Automatic Migration

```bash
# Preview changes
node scripts/migrate-agents.js --dry-run

# Apply migration
node scripts/migrate-agents.js
```

Backups created at `~/.kai/workflows/*.backup`

---

## Configuration

### Environment Variables

```bash
# API Keys
YOUTUBE_API_KEY=xxx
OPENAI_API_KEY=xxx

# Paths
KAI_DIR=~/.kai
METRICS_DIR=~/.kai/metrics

# Daemon
KAI_DAEMON_LOG_LEVEL=info
```

### Agent Config

Stored in `agents.config` field (JSON):
```json
{
  "personaId": "youtube-expert",
  "search_keywords": ["build in public"],
  "min_views": 1000
}
```

Access in workflow: `${config.search_keywords}`

---

## Troubleshooting

### Common Issues

**Issue**: Agent not running
```bash
# Check if enabled
kai agent info <id>

# Check logs
kai agent output <id>
```

**Issue**: Skill not found
```bash
# List loaded skills
node -e "require('./dist/skills/loader.js').loadAllSkills().then(() => console.log(require('./dist/skills/loader.js').getLoadedSkills().map(s => s.manifest.id)))"

# Check skill exists
ls ~/.kai/skills/builtin-data/
```

**Issue**: Checkpoint not resuming
```bash
# Check checkpoints
sqlite3 ~/.kai/agents.db "SELECT run_id, step_index, created_at FROM checkpoints WHERE run_id = 'run-xxx'"

# Check run status
sqlite3 ~/.kai/agents.db "SELECT id, status, current_step FROM runs WHERE id = 'run-xxx'"
```

**Issue**: Build failures
```bash
# Clean build
rm -rf dist
npm run build

# Check specific error
npm run build:server 2>&1 | grep "error TS"
```

---

## API Reference

### Skills API

```typescript
// Load all skills
loadAllSkills(): Promise<void>

// Get specific skill
getSkill(id: string): LoadedSkill | undefined

// Get all loaded skills
getLoadedSkills(): LoadedSkill[]

// Get OpenAI-compatible tool definitions
getSkillToolDefinitions(): ChatCompletionTool[]
```

### Workflow API

```typescript
// Execute workflow
executeWorkflow(
  workflow: WorkflowDefinition,
  agentId: string,
  configOverrides?: Record<string, any>,
  onProgress?: (step: string, status: string) => void,
  options?: { resumeFrom?: string }
): Promise<{ success: boolean; results: Record<string, any>; error?: string; runId?: string }>

// Parse workflow YAML
parseWorkflow(path: string): WorkflowDefinition

// Register integration (deprecated)
registerIntegration(handler: IntegrationHandler): void
```

### Resume API

```typescript
// Resume a run
resumeRun(
  runId: string,
  onProgress?: (step: string, status: string) => void
): Promise<{ success: boolean; results: Record<string, any>; error?: string; runId?: string }>

// Find interrupted runs
findInterruptedRuns(): Array<{ id, agent_id, started_at, step_index }>

// Recover all interrupted runs
recoverAll(options?: { olderThanMinutes?: number }): Promise<{ recovered: string[]; failed: string[] }>

// Get resume status
getResumeStatus(runId: string): { canResume: boolean; status: string; lastCheckpoint?: {...} }
```

### Analysis API

```typescript
// Analyze agent performance
analyzeAgentPerformance(agentId: string): AgentPerformanceAnalysis

// Compare time periods
comparePeriods(agentId: string, period1: DateRange, period2: DateRange): ComparisonResult

// Analyze specific run
analyzeRunSteps(runId: string): StepAnalysis[]
```

### Experiments API

```typescript
// Create experiment
createExperiment(agentId: string, variants: ExperimentVariant[]): Promise<Experiment>

// Run variant
runVariant(variantId: string, workflow: WorkflowDefinition): Promise<ExperimentRun>

// Run full experiment
runExperiment(experimentId: string, iterationsPerVariant?: number): Promise<void>

// Compare results
compareResults(experimentId: string): Promise<ComparisonResult>

// List experiments
listExperiments(agentId?: string): Experiment[]

// Get experiment details
getExperiment(experimentId: string): Experiment & { variants: ExperimentVariant[] }

// Delete experiment
deleteExperiment(experimentId: string): void
```

### Optimization API

```typescript
// Check if optimization needed
checkOptimizationNeeded(agentId: string): OptimizationCheckResult

// Trigger optimization
triggerOptimization(agentId: string): Promise<OptimizationResult>

// Run global check
runGlobalOptimizationCheck(autoTrigger?: boolean): Promise<{ checked: number; triggered: number; skipped: number }>

// Enable auto-optimization
enableAutoOptimization(config?: Partial<TriggerConfig>): () => void  // Returns disable function

// Get status
getOptimizationStatus(agentId: string): TriggeredOptimization | undefined
listActiveOptimizations(): TriggeredOptimization[]
```

---

## Best Practices

### 1. Use Skills, Not Integrations
```yaml
# Good
type: skill
skill: data

# Avoid (deprecated)
type: integration
integration: data
```

### 2. Always Set output_var
```yaml
steps:
  - name: process
    type: skill
    skill: youtube
    action: search_videos
    output_var: search_results  # ← Always set this
```

### 3. Use Checkpoints for Long Workflows
Checkpointing is automatic. For multi-step workflows, the system will handle crashes.

### 4. Enable Review for Quality
```yaml
review:
  enabled: true
  max_iterations: 2
  review_prompt: |
    Check output quality criteria...
```

### 5. Regular Optimization
```bash
# Weekly optimization check
kai agent optimize <agent-id>

# Monthly A/B test
kai agent create-variant <agent-id> <variant-name>
```

### 6. Monitor with CLI
```bash
# Check agent health
kai agent info <id>

# View recent runs
kai agent output <id>

# List interrupted
kai agent list-interrupted
```

---

## Roadmap & Future Enhancements

### Implemented ✅
- [x] Skills system with 5 built-in skills
- [x] Durable execution with checkpointing
- [x] Crash recovery and resume
- [x] Pattern analysis engine
- [x] A/B testing framework
- [x] Optimization triggers
- [x] CLI commands for all features
- [x] Web UI workflow editor

### Planned 🔮
- [ ] Web UI dashboard for self-improvement metrics
- [ ] Automatic variant generation with LLM
- [ ] Advanced pattern detection (ML-based)
- [ ] Cross-agent learning
- [ ] Skill marketplace
- [ ] Distributed execution
- [ ] Real-time collaboration

---

## Support & Resources

- **CLI Help**: `kai agent --help`
- **Workflow Examples**: `~/.kai/workflows/`
- **Skill Development**: See `src/skills/builtins/` for examples
- **Database**: `~/.kai/agents.db` (SQLite)

---

**System Version**: v2.0.0  
**Last Updated**: April 2026  
**Status**: Production Ready ✅
