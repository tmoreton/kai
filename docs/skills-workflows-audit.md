# Skills, Tools & Workflows Audit

**Date:** 2026-04-03

---

## Current Architecture

### Tools (`src/tools/`)
- **Status:** ✅ Clean - No hardcoding found
- **Pattern:** Atomic operations, definitions in `definitions.ts`
- **Location:** All in source code, properly modularized

### Skills (`src/skills/`)
- **Hardcoded in `builtin.ts`:**
  ```typescript
  const BUILTIN_SKILLS = ["browser", "email"];
  ```
- **Physical skills:** `src/skills/builtins/browser/`, `src/skills/builtins/email/`
- **Runtime location:** `~/.kai/skills/builtin-*`
- **Issue:** Hardcoded array limits extensibility

### Workflows (`src/agents-core/builtin-workflows/`)
- **Hardcoded in `bootstrap.ts`:**
  ```typescript
  const BUILTIN_AGENTS = [
    { id: "agent-kai-backup", name: "Kai Backup", ... },
    { id: "agent-kai-memory-cleanup", name: "Kai Memory Cleanup", ... },
    { id: "agent-kai-self-diagnosis", name: "Kai Self-Diagnosis", ... },
    { id: "agent-kai-self-heal", name: "Kai Self-Heal", ... },
  ];
  ```
- **Physical workflows:** 4 YAML files in `builtin-workflows/`
- **Runtime location:** `~/.kai/workflows/`
- **Issue:** Hardcoded array limits extensibility

---

## Problems Identified

### 1. Hardcoded Lists
Both skills and agents have hardcoded TypeScript arrays that require code changes to extend.

### 2. Bundled Assets
Built-in workflows and skills are bundled in the repo, making them hard to update independently.

### 3. No External Loading
System doesn't support loading skills/workflows from external sources (git repos, npm packages, etc.)

---

## Recommended Solution

### Phase 1: Config-Driven Built-ins (Immediate)
Move hardcoded lists to JSON/YAML config files:

```
config/
├── builtin-agents.json    # Replaces BUILTIN_AGENTS array
└── builtin-skills.json    # Replaces BUILTIN_SKILLS array
```

Benefits:
- No code changes needed to add built-ins
- Users can override via `~/.kai/config/`
- Still bundled, but configurable

### Phase 2: External Skills Repository (Later)
Create separate `kai-skills` repo:

```
kai-skills/
├── skills/
│   ├── browser/
│   ├── email/
│   ├── web-search/
│   └── ...
└── registry.json          # Skill catalog
```

Install via:
```bash
kai skill install kai-skills/browser
kai skill install github:user/custom-skill
```

### Phase 3: Marketplace (Future)
- Curated skill registry
- Version management
- Dependency resolution

---

## Immediate Action Plan

1. **Extract hardcoded agents to JSON config**
2. **Extract hardcoded skills to JSON config**
3. **Update bootstrap loaders to read from config**
4. **Keep workflows in repo** (they're tightly coupled to the system)

This gives us:
- ✅ No hardcoding
- ✅ Configurable built-ins
- ✅ Easy to extend
- ✅ No external dependencies yet
- ✅ Foundation for future external repo
