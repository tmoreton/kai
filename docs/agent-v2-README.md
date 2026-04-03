# Kai Agent System v2

Event-driven, durable, autonomous agent system. Single-process, SQLite-backed, compiles to one executable.

## Overview

Kai Agent v2 is a complete rewrite of the agent orchestration layer with these key features:

- **Event-driven**: Triggers fire in <100ms (not 30s polling)
- **Durable execution**: Crash recovery with checkpoint/resume
- **Goal orchestration**: Break complex goals into coordinated sub-agents
- **Templates**: Spawn agents dynamically from blueprints
- **Self-improvement**: System analyzes its own performance

## Architecture

```
Events (file, email, cron) → Event Bus → Scheduler → Durable Runner → Results
                                              ↓
                                    Goals → Orchestrator → Sub-agents
                                              ↓
                                    Meta-Learner → Suggestions → Auto-improve
```

## Quick Start

### 1. Create a Goal (Phase 3)

```bash
kai agent-v2 goal "Launch YouTube channel with 10 videos"
```

This will:
- Create a high-level goal
- Decompose it into sub-goals (research, content calendar, branding)
- Spawn agents for each sub-goal
- Coordinate execution with fan-out/fan-in
- Synthesize results into a final plan

### 2. Spawn from Template (Phase 4)

```bash
# List available templates
kai agent-v2 templates

# Spawn a YouTube scout agent
kai agent-v2 spawn youtube-scout --config '{"topics":["AI","coding"]}'

# Run it immediately
kai agent-v2 run <agent-id>
```

### 3. Durable Execution (Phase 2)

```bash
# Run with checkpoint/resume
kai agent-v2 run my-agent

# Resume after crash
kai agent-v2 resume <run-id>

# Recover all interrupted runs
kai agent-v2 recover
```

### 4. Meta-Learning (Phase 5)

```bash
# Analyze an agent's performance
kai agent-v2 analyze my-agent

# Apply suggested improvements (high confidence only)
kai agent-v2 improve my-agent

# Run on all agents (daily cron task)
kai agent-v2 meta-learn
```

## Phases Implemented

### Phase 1: Event Bus ✓

- In-process pub/sub (<1ms latency)
- File watching (`fs.watch()`)
- Email polling → events
- Cron triggers via `node-cron`

**Files**: `event-bus.ts`, `watchers/file.ts`, `watchers/email.ts`, `scheduler.ts`

### Phase 2: Durable Execution ✓

- Checkpoint before each step
- Resume from last checkpoint on crash
- Recovery on daemon startup

**Files**: `checkpoint.ts`, `runner-durable.ts`

**Database additions**:
```sql
ALTER TABLE runs ADD COLUMN current_step INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN context TEXT DEFAULT '{}';
CREATE TABLE checkpoints (...);
```

### Phase 3: Goal Orchestrator ✓

- Goal decomposition via LLM
- Dependency-respecting execution
- Fan-out (parallel sub-agents) → Fan-in (wait for all)
- Result synthesis

**Files**: `orchestrator.ts`

**Database additions**:
```sql
CREATE TABLE goals (...);
CREATE TABLE goal_runs (...);
```

### Phase 4: Template System ✓

- Pre-defined agent blueprints
- Dynamic spawning with inheritance
- Auto-trigger registration

**Files**: `templates.ts`

**Built-in templates**:
- `youtube-scout` - Trend monitoring
- `self-heal` - Error monitoring
- `code-reviewer` - PR reviews
- `researcher` - Information gathering
- `writer` - Content creation

### Phase 5: Meta-Learning ✓

- Run history analysis
- LLM-based insight generation
- Auto-apply high-confidence suggestions (>0.9)
- Notify on medium-confidence (0.7-0.9)

**Files**: `meta-learner.ts`

## CLI Commands

```bash
# Goals
kai agent-v2 goal <description>          # Create and orchestrate a goal
kai agent-v2 decompose <goal-id>         # Show sub-goals without executing

# Templates
kai agent-v2 templates                   # List available templates
kai agent-v2 spawn <template> [name]     # Spawn agent from template

# Durable Execution
kai agent-v2 run <agent-id>              # Run with checkpoint/resume
kai agent-v2 resume <run-id>             # Resume interrupted run
kai agent-v2 recover                     # Recover all interrupted runs

# Meta-Learning
kai agent-v2 analyze <agent-id>          # Analyze run history
kai agent-v2 improve <agent-id>          # Apply suggestions
kai agent-v2 meta-learn                  # Daily analysis of all agents

# Testing
kai agent-v2 watch <file>                # Watch file and show events
```

## Migration from v1

The v2 system is backward compatible:

1. Existing agents continue to work
2. Cron schedules are automatically converted to event triggers
3. Heartbeat conditions are converted where possible
4. Both systems can run side-by-side during transition

On daemon startup:
- v1 agents with schedules get v2 event triggers registered
- Heartbeat conditions become file/webhook watchers
- Self-healing still runs every 3 minutes

## Configuration

### Environment Variables

```bash
YOUTUBE_API_KEY        # Required for youtube-scout template
OPENROUTER_API_KEY     # Required for LLM calls
RESEND_API_KEY         # For email watcher
IMAP_HOST              # For email watcher
```

### Agent Config

```json
{
  "heartbeat": {
    "enabled": true,
    "conditions": [
      { "type": "file_changed", "check": "~/data/input.json" },
      { "type": "webhook", "check": "https://api.example.com/webhook" }
    ]
  }
}
```

## Success Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Trigger latency | <100ms | ✓ ~50ms |
| Crash recovery | Resume exact step | ✓ Working |
| Goal orchestration | 5 sub-agents | ✓ Working |
| Template spawning | <5 seconds | ✓ Working |
| Meta-learning suggestions | 80% valid | ⚠ Needs testing |

## Next Steps

### Phase 6: Single Executable

Bundle Node.js + app + SQLite into one binary:

```bash
npm run build:exe
# Creates: releases/kai-macos-arm64, kai-linux-x64, kai-win-x64
```

**Tools**: `pkg` or Node.js SEA (Single Executable API)

## File Structure

```
src/agents-v2/
├── index.ts              # Public API exports
├── types.ts              # TypeScript definitions
├── event-bus.ts          # Pub/sub system
├── checkpoint.ts         # Crash recovery
├── scheduler.ts          # Trigger registration
├── runner.ts             # Basic runner (wraps durable)
├── runner-durable.ts     # Checkpoint/resume runner
├── orchestrator.ts       # Goal decomposition
├── templates.ts          # Template system
├── meta-learner.ts       # Self-improvement
├── watchers/
│   ├── file.ts           # File watching
│   └── email.ts          # Email polling
└── test/                 # Test utilities
```

## Testing

```bash
# Test event-driven triggers
kai agent-v2 watch ~/test-file.txt
# In another terminal: echo "test" >> ~/test-file.txt

# Test durable execution
kai agent-v2 run my-agent
# Kill process mid-run, then: kai agent-v2 resume <run-id>

# Test goal orchestration
kai agent-v2 goal "Research AI coding tools"
```

## API Usage

```typescript
import {
  createGoal,
  orchestrateGoal,
  spawnFromTemplate,
  runDurable,
  analyzeAgent,
} from "./agents-v2/index.js";

// Create and orchestrate a goal
const goalId = await createGoal("Build a landing page", 1);
await orchestrateGoal(goalId);

// Spawn from template
const agentId = await spawnFromTemplate("youtube-scout", {
  topics: ["AI", "coding"]
});

// Run with durability
const result = await runDurable(agentId);

// Analyze and improve
const analysis = await analyzeAgent(agentId);
console.log(analysis.suggestions);
```
