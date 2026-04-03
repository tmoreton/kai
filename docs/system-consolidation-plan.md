# System Audit & Consolidation Plan

**Date:** 2026-04-03  
**Scope:** Full system cleanup post agents-v2 migration

---

## Executive Summary

The system has a **clean agents-v2 implementation** that is actively used, but still carries legacy V1 code in `src/agents/` that creates confusion and maintenance burden. The key issue is **dual architecture** - files in `src/agents/` are mostly wrappers/re-exports while the real implementation lives in `src/agents-v2/`.

**Priority: HIGH** - The following files can be safely removed or consolidated immediately.

---

## 1. Agent System - Immediate Removals

### Files to Delete (Confirmed Unused)

| File | Lines | Reason | Impact |
|------|-------|--------|--------|
| `src/agents/checkpoint.ts` | 13 | Pure re-export to agents-v2 | Zero - import from agents-v2 directly |
| `src/agents/test-harness.ts` | 870 | Not imported anywhere | Zero - test utilities not used |
| `src/agents/test-durable.ts` | ~200 | Not imported anywhere | Zero - test file |
| `src/agents/conditions.ts` | ~150 | Only imported by daemon.ts line 30 | Low - move logic to daemon or agents-v2 |

### Files to Consolidate

| File | Destination | Notes |
|------|-------------|-------|
| `src/agents/notify-email.ts` + `src/agents/email-poller.ts` | `src/agents-v2/services/email.ts` | Merge into unified email service |
| `src/agents/resume.ts` | Merge into `src/agents-v2/runner-durable.ts` | Duplicates recovery logic |
| `src/agents/bootstrap.ts` | Keep (used by repl.ts:38) | Keep but simplify |
| `src/agents/daemon.ts` | Gradually migrate to agents-v2 | Complex - used by web routes |

### Key Database Pattern (KEEP)

`src/agents/db.ts` (25666 bytes) - **KEEP AS-IS**
- This is the canonical database layer
- Used by: agents-v2/runner.ts, agents-v2/checkpoint.ts, web/routes/, error-tracker.ts, commands/, etc.
- This is NOT duplicate - it's the shared persistence layer

### Workflow Engine (KEEP)

`src/agents/workflow.ts` (42354 bytes) - **KEEP AS-IS**
- Canonical workflow engine used by agents-v2/runner.ts and runner-durable.ts
- Contains: parseWorkflow, executeWorkflow, WorkflowStep types
- The "integration" type deprecation can be cleaned up but file stays

---

## 2. Tools vs Skills Overlap (Medium Priority)

### Current State

Both systems exist in parallel:
- `src/tools/` - 13 files, lower-level primitives
- `src/skills/` - 6 files, higher-level compositions

### Analysis

**Skills ARE different from tools:**
- Tools = atomic operations (file read, bash exec, web fetch)
- Skills = composed workflows that may use multiple tools

**However, there is overlap:**

| Skill | Overlaps With | Action |
|-------|---------------|--------|
| `builtin.ts` skills | Various tools | Review each - some may be redundant |
| `executor.ts` | `tools/executor.ts` | Consolidate naming |

**Recommendation:** Keep both systems but ensure clear separation:
- Tools: atomic, stateless, immediate
- Skills: can be stateful, async, multi-step

---

## 3. Web Layer Consolidation (Low Priority)

### Duplicates Found

| Issue | Location | Fix |
|-------|----------|-----|
| `createNewSession()` duplicated | `agents.ts:55` and `chat.ts:38` | Extract to `web/utils.ts` |
| `/api/agent-chat` endpoint | `agents.ts:669` | Deprecate, use `/api/agents/:id/chat` |
| Error handling inconsistent | All routes | Standardize on `handleError()` utility |

### Good News

Web layer is properly integrated with agent system:
- All agent routes use `agents/db.js` directly
- No local state maintained (ephemeral streams only)
- Clean separation between transport and business logic

---

## 4. REPL/CLI Layer (Clean - No Action)

**Verdict: Well-architected, no consolidation needed**

| File | Purpose | Status |
|------|---------|--------|
| `commands.ts` | User-defined markdown commands | Keep |
| `repl-commands.ts` | Built-in slash commands | Keep |
| `repl.ts` | Orchestration | Keep |

Minor improvement possible: Move `commands.ts` imports to single location, but not urgent.

---

## 5. Configuration & Root Level (Low Priority)

### Dependencies

All package.json dependencies appear legitimate and used.

### Documentation

| File | Status | Action |
|------|--------|--------|
| `docs/AGENT_SYSTEM.md` | Outdated (V1) | Archive or update |
| `docs/agent-v2-*.md` | Current | Keep |
| `docs/agent-system-audit.md` | This audit replaces it | Archive |

### Build Artifacts

`dist/` is in .gitignore - good. But tauri bundles contain stale files:
- `src-tauri/target/release/bundle/macos/Kai.app/Contents/Resources/dist/agents/test-*.d.ts`

These will be cleaned up on next build.

---

## 6. Consolidation Execution Plan

### Phase 1: Safe Removals (Immediate)

```bash
# Delete pure re-exports and test files
rm src/agents/checkpoint.ts
rm src/agents/test-harness.ts  
rm src/agents/test-durable.ts

# Update imports
grep -r "from.*agents/checkpoint" src --include="*.ts" | wc -l  # Should be 0
```

### Phase 2: Email System Consolidation

```bash
# Create unified email service
mkdir -p src/agents-v2/services
cat src/agents/notify-email.ts src/agents/email-poller.ts > src/agents-v2/services/email.ts
# Then clean up and remove originals
```

### Phase 3: Resume Logic Merge

```bash
# Merge resume.ts into runner-durable.ts
# Keep only the recoverAll() export that daemon.ts uses
```

### Phase 4: Documentation Cleanup

```bash
mkdir -p docs/archive
mv docs/AGENT_SYSTEM.md docs/archive/
mv docs/agent-system-audit.md docs/archive/
```

---

## 7. Dependency Graph Summary

### Critical Path (KEEP)

```
src/agents/db.ts
  → Used by: agents-v2/*, web/routes/*, error-tracker.ts, commands/*
  
src/agents/workflow.ts  
  → Used by: agents-v2/runner.ts, agents-v2/runner-durable.ts
  
src/agents/daemon.ts
  → Used by: web/routes/agents.ts (runAgent export)
```

### Can Be Removed

```
src/agents/checkpoint.ts → Re-export only, no unique imports
src/agents/test-harness.ts → No imports found
src/agents/test-durable.ts → No imports found  
src/agents/conditions.ts → Only used by daemon.ts, merge in
```

### Needs Consolidation

```
src/agents/notify-email.ts + email-poller.ts → Merge to service
src/agents/resume.ts → Merge into runner-durable.ts
```

---

## 8. Final Architecture Goal

```
src/
  agents/
    db.ts              # Canonical persistence (KEEP)
    workflow.ts        # Canonical workflow engine (KEEP)
    daemon.ts          # Scheduler + coordinator (simplify)
    bootstrap.ts       # Built-in agent setup (KEEP)
    manager.ts         # CLI interface (KEEP)
    builtin-workflows/ # YAML workflows (KEEP)
    
  agents-v2/
    index.ts           # Public API
    runner.ts          # Workflow execution
    runner-durable.ts  # With checkpoint/resume
    checkpoint.ts      # State persistence
    event-bus.ts       # Pub/sub
    watchers/          # File, email, etc.
    services/          # Email, notifications
    
  tools/               # Atomic operations
  skills/              # Composed workflows
  web/                 # HTTP layer
```

---

## 9. Action Items Checklist

- [x] Audit complete
- [ ] Delete checkpoint.ts (re-export)
- [ ] Delete test-harness.ts
- [ ] Delete test-durable.ts
- [ ] Merge email services
- [ ] Merge resume.ts into runner-durable.ts
- [ ] Update daemon.ts to remove conditions.ts dependency
- [ ] Create web/utils.ts for shared functions
- [ ] Archive old documentation
- [ ] Verify no broken imports after changes
- [ ] Run full test suite
