# LLM Token Consumption Audit
**Date:** 2026-04-09  
**Auditor:** Kai  
**Scope:** Complete token flow from API calls through context management

---

## 📊 Current Usage Snapshot

| Metric | Today (2026-04-09) | Notes |
|--------|-------------------|-------|
| **Input Tokens** | ~135K | 9 separate API calls |
| **Output Tokens** | ~1.2K | Very low response ratio |
| **Total Tokens** | ~136K | Audit session alone |
| **Avg Input/Call** | ~15K | High context per request |
| **Avg Output/Call** | ~134 | Short responses |

**Observation:** This single audit session consumed significant tokens due to large file reads being passed as context.

---

## 🏗️ Token Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     SYSTEM PROMPT (~2000 tokens)               │
│  - Core memory, tool definitions (~5000), environment info    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    CONVERSATION HISTORY                      │
│  - Recent messages: full content                            │
│  - Tier 2 (11-20): truncated to 500 tokens                  │
│  - Tier 3 (21-30): truncated to 200 tokens                  │
│  - Older: summarized via compaction                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     TOOL OUTPUTS                            │
│  - Limited to 1000 tokens per result                          │
│  - File reads: up to 2000 lines (very large!)                │
│  - Parallel execution: deduped reads                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    [API REQUEST]
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   CONTEXT WINDOW: 256K tokens                │
│              Current threshold: Compact at 60%              │
│              Truncate tiered at 30%                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 Detailed Findings

### 1. **HIGH-PRIORITY: File Read Token Bloat**

**Issue:** `read_file` defaults to 2000 lines (~8000 chars ≈ 2000 tokens per file)

**Evidence from audit:**
- `src/client.ts` read: ~20K chars = ~5K tokens
- `src/context.ts` read: ~14K chars = ~3.5K tokens
- Multiple file reads in single request = 15K+ input tokens

**Current Mitigations:**
- Parallel read deduplication exists (good)
- No default line limit enforcement in file reads

**Optimization Potential:** 🔴 **HIGH** - Could reduce input tokens by 40-60%

---

### 2. **MEDIUM-PRIORITY: Tool Definitions Always Sent**

**Issue:** ~5000 tokens of tool definitions included in EVERY request

**Current State:**
```typescript
// From context.ts line 112
total += 5000;  // Fixed overhead per request
```

**Components:**
- 25+ built-in tools with full JSON schemas
- MCP tools (variable)
- User skill tools (variable)

**Current Mitigations:**
- ✅ Intent-based tool filtering (reduces tools for read-only queries)
- ✅ Agent tool restrictions (explorers get subset)

**Optimization Potential:** 🟡 **MEDIUM** - Could reduce by 20-30% with dynamic loading

---

### 3. **MEDIUM-PRIORITY: System Prompt Caching**

**Issue:** System prompt rebuilt frequently, no true caching across requests

**Current State:**
```typescript
// system-prompt.ts - cached per session only
let _cachedSystemPrompt: string | null = null;
```

**Contents:**
- Base system prompt: ~3000 chars = ~750 tokens
- Core memory context: ~2000 tokens (SOUL_CONTEXT_BUDGET)
- Project profile: ~500 tokens
- Archival knowledge: up to 10 entries
- Git info: variable

**Optimization Potential:** 🟡 **MEDIUM** - Rebuilding wastes ~1000-2000 tokens of re-processing

---

### 4. **LOW-PRIORITY: Context Window Underutilization**

**Issue:** Compaction triggers at 60% (153K tokens) but model supports 256K

**Current Thresholds:**
```typescript
// constants.ts
COMPACT_THRESHOLD = 0.60;  // 153.6K tokens
TIERED_TRUNCATE_THRESHOLD = 0.30;  // 76.8K tokens
```

**Trade-off:** Earlier compaction = fewer tokens per request but more API calls

**Optimization Potential:** 🟢 **LOW** - Current settings are conservative but safe

---

### 5. **POSITIVE FINDINGS: Existing Optimizations Working**

| Feature | Status | Impact |
|---------|--------|--------|
| **Tiered truncation** | ✅ Active | Saves ~30% on long conversations |
| **Parallel tool execution** | ✅ Active | Reduces latency, dedupes reads |
| **Intent-based filtering** | ✅ Active | Reduces tool count for queries |
| **Usage tracking** | ✅ Active | SQLite with delta recording |
| **Response streaming** | ✅ Active | Early token visibility |
| **Context size caching** | ✅ Active | O(1) context checks |

---

## 💡 Optimization Recommendations

### Immediate (This Week)

#### 1. **Enforce Default Line Limits on File Reads**
```typescript
// In read_file tool - add default limit
const DEFAULT_READ_LINES = 100;  // ~400 tokens vs 2000 lines = 8000 tokens
const MAX_READ_LINES = 500;      // Hard cap at ~2000 tokens

// Add to tool definition:
limit: { 
  type: "number", 
  default: 100,  // Enforce conservative default
  maximum: 500   // Hard ceiling
}
```
**Estimated Savings:** 40-60% reduction in file-related input tokens

#### 2. **Smart File Read Strategy**
```typescript
// Add "preview mode" to read_file
interface ReadOptions {
  preview?: boolean;  // Only read first 50 lines
  grep_filter?: string;  // Pre-filter before returning
}
```
**Use Case:** Code exploration without full file context

---

### Short-term (Next 2 Weeks)

#### 3. **Dynamic Tool Loading**
```typescript
// Instead of sending all tools, categorize:
const TOOL_CATEGORIES = {
  core: ["bash", "read_file", "edit_file"],  // Always sent
  dev: ["git", "build", "test"],              // Added when file ops detected
  web: ["web_search", "web_fetch"],          // Added when URLs detected
  memory: ["core_memory", "archival"],        // Added for memory ops
}
```
**Estimated Savings:** 20-30% reduction in base overhead

#### 4. **Semantic File Chunking**
```typescript
// For large files, return only relevant sections:
function extractRelevantChunks(
  fileContent: string, 
  query: string
): string[] {
  // Use embeddings or simple keyword matching
  // Return top 3 most relevant chunks
}
```
**Use Case:** Reading 10K line files but only need specific functions

---

### Medium-term (Next Month)

#### 5. **Response Caching for Common Queries**
```typescript
// Cache LLM responses for identical contexts:
const responseCache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 60,  // 1 hour
  keyGenerator: (messages, tools) => hash(messages + toolNames)
});
```
**Use Case:** "Find all files matching X" often repeated

#### 6. **Adaptive Context Window**
```typescript
// Adjust thresholds based on task type:
function getDynamicThreshold(taskType: TaskType): number {
  return {
    'code-gen': 0.80,     // Keep more context for generation
    'explore': 0.50,      // Compact early for exploration
    'debug': 0.70,        // Balance for debugging
  }[taskType];
}
```

---

## 📈 Projected Token Savings

| Optimization | Input Token Savings | Output Token Impact | Implementation Effort |
|-------------|---------------------|--------------------|----------------------|
| File read limits | 40-60% | None | Low |
| Dynamic tools | 20-30% | None | Medium |
| Response caching | 10-20% | None | Medium |
| Smart chunking | 30-50% | None | High |
| Adaptive context | 10-15% | None | Medium |
| **Combined** | **60-75%** | **Neutral** | **-** |

---

## 🎯 Action Items

1. **Add default line limit to `read_file`** - Estimated 1 hour
2. **Implement tool category loading** - Estimated 4 hours  
3. **Add file preview mode** - Estimated 2 hours
4. **Create response cache** - Estimated 4 hours
5. **Audit usage after changes** - Estimated 30 minutes

---

## 📋 Monitoring Checklist

Post-implementation, verify:
- [ ] Average tokens per request decreased
- [ ] File read operations stay under 500 tokens each
- [ ] No regression in response quality
- [ ] Context compaction frequency reduced
- [ ] API costs per session decreased

---

**Next Audit:** Schedule for 2 weeks post-implementation to measure actual savings.
