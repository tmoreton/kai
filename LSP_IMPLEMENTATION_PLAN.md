# LSP vs Grep: Implementation Plan & Processing Savings Analysis

## Current State: Grep-Based Code Search

### How It Works
- **Tool**: `grepTool()` in `src/tools/search.ts`
- **Implementation**: Spawns `ripgrep` (rg) or falls back to system `grep`
- **Process**: Every search spawns a new process, scans the entire file system
- **Usage Stats**: ~178 TypeScript files in src/, 1.1MB total code

### Performance Baseline (measured on codebase)
| Operation | Tool | Time | Process Spawns |
|-----------|------|------|----------------|
| Interface search | grep | 16ms | 1 |
| Function search | grep | ~16ms | 1 |
| Import search | grep | ~16ms | 1 |
| Typical session | grep | 200-500ms total | 10-30 |

### Current Grep Usage Patterns (from codebase analysis)
1. **Finding definitions**: `grep pattern="export function|class|interface"`
2. **Finding imports**: `grep pattern="import.*from"`
3. **Finding usages**: `grep pattern="functionName"`
4. **Pattern discovery**: `grep pattern="TODO|FIXME|BUG"`

---

## Proposed: LSP-Based Code Intelligence

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LSP Server Manager                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ TypeScript  │  │  Python     │  │  Rust/Go/etc        │ │
│  │ (tsserver)  │  │  (pylsp)    │  │  (rust-analyzer)    │ │
│  │             │  │             │  │                     │ │
│  │ • Symbols   │  │ • Symbols   │  │ • Symbols           │ │
│  │ • Hover     │  │ • Hover     │  │ • Hover             │ │
│  │ • Go-to-def │  │ • Go-to-def │  │ • Go-to-def         │ │
│  │ • Refs      │  │ • Refs      │  │ • Refs              │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         └─────────────────┴────────────────────┘            │
│                         │                                   │
│                         ▼                                   │
│              ┌─────────────────────┐                        │
│              │   Symbol Index      │                        │
│              │   (In-Memory)       │                        │
│              │                     │                        │
│              │ • file → symbols    │                        │
│              │ • symbol → locations  │                      │
│              │ • type information  │                        │
│              └─────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   Kai Tools      │
                    │                  │
                    │ • find_symbol    │
                    │ • goto_definition│
                    │ • find_references│
                    │ • get_type_info  │
                    │ • list_symbols   │
                    └──────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (2-3 days)

**Files to Create:**
```
src/lsp/
├── manager.ts          # LSP server lifecycle management
├── client.ts           # JSON-RPC client wrapper
├── index.ts            # Symbol index builder
├── types.ts            # LSP types/interfaces
├── adapters/
│   ├── typescript.ts   # tsserver wrapper
│   ├── python.ts       # pylsp wrapper
│   └── generic.ts      # fallback LSP adapters
└── tools.ts            # Kai tool replacements for grep
```

**Key Components:**

1. **LSPManager** - Server lifecycle
```typescript
class LSPManager {
  private servers: Map<string, LSPConnection> = new Map();
  
  async startServer(workspace: string, language: string): Promise<LSPConnection>
  async stopServer(workspace: string): Promise<void>
  async restartServer(workspace: string): Promise<void>
  getConnection(workspace: string): LSPConnection | null
}
```

2. **SymbolIndex** - In-memory index
```typescript
class SymbolIndex {
  private symbols: Map<string, SymbolInfo[]> = new Map(); // file -> symbols
  private byName: Map<string, SymbolLocation[]> = new Map(); // name -> locations
  
  async buildIndex(files: string[]): Promise<void>
  async updateFile(file: string, content: string): Promise<void>
  findSymbols(query: string): SymbolLocation[]
  findByType(type: 'function' | 'class' | 'interface' | 'variable'): SymbolInfo[]
}
```

3. **New Tools** (replacing grep)
```typescript
// Instead of: grep pattern="export function"
// Use: list_symbols(type="function", exported=true)

// Instead of: grep pattern="class MyClass"
// Use: goto_definition(name="MyClass")

// Instead of: grep pattern="myFunction\("
// Use: find_references(name="myFunction")
```

---

### Phase 2: Tool Replacements (1-2 days)

| Current Grep | New LSP Tool | Speed Improvement |
|--------------|--------------|-------------------|
| `grep pattern="export function"` | `list_symbols(type="function")` | **50-100x** (cached) |
| `grep pattern="class MyClass"` | `goto_definition(name="MyClass")` | **100x** (direct lookup) |
| `grep pattern="myFunc\("` | `find_references(name="myFunc")` | **50x** (semantic) |
| `grep pattern="TODO"` | `search_comments(type="TODO")` | **10x** (still text) |
| `grep pattern="import.*from` | `list_imports(file)` | **100x** (AST-based) |

**Tool Implementations:**

```typescript
// src/lsp/tools.ts
export async function findSymbol(args: {
  name: string;
  type?: 'function' | 'class' | 'interface' | 'variable';
  file?: string;
}): Promise<string> {
  const index = await getSymbolIndex();
  const results = index.findByName(args.name, args.type);
  return formatResults(results);
}

export async function gotoDefinition(args: {
  name: string;
  file?: string;
  line?: number;
  column?: number;
}): Promise<string> {
  const conn = getLSPConnection(args.file);
  if (!conn) return fallbackToGrep(args);
  
  const locations = await conn.gotoDefinition(args);
  return formatLocations(locations);
}

export async function findReferences(args: {
  name: string;
  file?: string;
}): Promise<string> {
  const conn = getLSPConnection(args.file);
  if (!conn) return fallbackToGrep(args);
  
  const refs = await conn.findReferences(args.name);
  return formatReferences(refs);
}
```

---

### Phase 3: File Watching & Incremental Updates (2 days)

```typescript
// src/lsp/watcher.ts
import { watch } from 'chokidar';

class FileWatcher {
  private watcher: FSWatcher;
  
  start(workspace: string): void {
    this.watcher = watch(`${workspace}/**/*.{ts,js,tsx,jsx}`, {
      ignored: EXCLUDED_DIRS,
      ignoreInitial: true,
    });
    
    this.watcher
      .on('add', (path) => this.onFileAdd(path))
      .on('change', (path) => this.onFileChange(path))
      .on('unlink', (path) => this.onFileRemove(path));
  }
  
  private async onFileChange(path: string): Promise<void> {
    const content = await fs.readFile(path, 'utf-8');
    await symbolIndex.updateFile(path, content);
    await lspManager.notifyChange(path, content);
  }
}
```

---

### Phase 4: Integration & Fallback (1-2 days)

**Integration Points:**

1. **Tool Executor** (`src/tools/executor.ts`)
```typescript
// Add LSP tools to executor
case "find_symbol":
  return await findSymbol(toolArgs);
case "goto_definition":
  return await gotoDefinition(toolArgs);
case "find_references":
  return await findReferences(toolArgs);
  
// Keep grep as fallback
case "grep":
  // Try LSP first if available, fall back to grep
  return await smartSearch(toolArgs);
```

2. **System Prompt** (`src/system-prompt.ts`)
```typescript
// Add LSP capabilities to context
const lspContext = hasLSP()
  ? "LSP mode active: Use find_symbol, goto_definition for code navigation"
  : "Fallback mode: Use grep for code search";
```

3. **Graceful Degradation**
```typescript
async function smartSearch(args: GrepArgs): Promise<string> {
  // Try LSP first
  const lsp = getLSPForPath(args.path);
  if (lsp?.isReady()) {
    const semanticResults = await trySemanticSearch(lsp, args);
    if (semanticResults) return semanticResults;
  }
  
  // Fall back to grep
  return grepTool(args);
}
```

---

## Processing Savings Analysis

### 1. Time Complexity Comparison

| Operation | Grep | LSP | Savings |
|-----------|------|-----|---------|
| **Find all functions** | O(n*m) - scan all files | O(1) - cached index | **99%** |
| **Go to definition** | O(n*m) - regex search | O(log n) - symbol tree | **95%** |
| **Find references** | O(n*m) - grep pattern | O(k) - pre-indexed refs | **90%** |
| **Type info** | Not possible | O(1) - type cache | **N/A** |
| **Import analysis** | O(n) - parse imports | O(1) - import graph | **95%** |

*n = files, m = lines per file, k = references*

### 2. Process Spawn Overhead

| Metric | Grep | LSP |
|--------|------|-----|
| Process spawns per search | 1 | 0 (reuse connection) |
| Startup cost per search | 10-50ms | 0ms |
| Cold start (project) | 0 | 2-5s (one time) |
| Memory overhead | 0 | 50-200MB |

**Typical Session Analysis:**
```
Grep-based session (30 searches):
- 30 process spawns × 20ms = 600ms overhead
- 30 full filesystem scans
- Total: ~2-5 seconds waiting on search

LSP-based session (30 semantic queries):
- 1 server start: 2s (amortized)
- 30 in-memory lookups: ~10ms each
- Total: ~2.3 seconds (mostly startup)
- Subsequent sessions: ~300ms
```

### 3. Real-World Benchmarks (Projected)

Based on ripgrep performance and typical LSP behavior:

| Scenario | Grep Time | LSP Time | Improvement |
|----------|-----------|----------|-------------|
| Find all exports (178 files) | 200ms | 5ms | **40x** |
| Go to definition (first) | 150ms | 50ms | **3x** |
| Go to definition (cached) | 150ms | 2ms | **75x** |
| Find references (complex) | 300ms | 20ms | **15x** |
| Type at cursor | N/A | 10ms | **New capability** |
| Import autocomplete | N/A | 5ms | **New capability** |

### 4. Token Savings in LLM Context

| Current Grep Output | LSP Output | Savings |
|---------------------|------------|---------|
| 50 matching lines with context (~2000 tokens) | Structured JSON (~200 tokens) | **90%** |
| Multiple grep calls to find related symbols | Single structured response | **70%** |
| Context window pollution from text matches | Precise semantic results | **80%** |

---

## Cost-Benefit Analysis

### Implementation Cost
| Phase | Time | Complexity |
|-------|------|------------|
| Phase 1: Core Infrastructure | 2-3 days | Medium |
| Phase 2: Tool Replacements | 1-2 days | Low |
| Phase 3: File Watching | 2 days | Medium |
| Phase 4: Integration | 1-2 days | Low |
| **Total** | **6-9 days** | **Medium** |

### Ongoing Benefits
| Benefit | Impact |
|---------|--------|
| 10-100x faster code navigation | High productivity |
| Precise semantic results vs regex | Better code understanding |
| New capabilities (type info, autocomplete) | Enhanced features |
| Reduced LLM context pollution | Lower token costs |
| Better large codebase support | Scalability |

### Trade-offs
| Aspect | Grep | LSP |
|--------|------|-----|
| Memory usage | Minimal | 50-200MB |
| Startup time | Instant | 2-5s cold start |
| Universal support | Yes (any text) | Language-specific |
| Complex patterns | Regex | Semantic only |
| Binary files | Yes | No |

---

## Recommended Implementation Strategy

### Option A: Hybrid Approach (Recommended)
**Timeline: 1 week**

1. Implement LSP for TypeScript/JavaScript (primary use case)
2. Keep grep as fallback for:
   - Non-TS projects
   - Text patterns (TODOs, comments)
   - When LSP unavailable
3. Gradual migration based on performance metrics

### Option B: Full Replacement
**Timeline: 2-3 weeks**

1. Implement LSP for all major languages
2. Add custom LSP for generic text search
3. Deprecate grep entirely

### Option C: Incremental Enhancement
**Timeline: 2-3 days**

1. Add file indexing layer on top of grep
2. Cache symbol locations from grep results
3. Hybrid queries (index + LSP when available)

---

## Key Technical Decisions

### LSP Server Selection
| Language | Server | Pros | Cons |
|----------|--------|------|------|
| TypeScript | tsserver | Native, fast | Memory hungry |
| TypeScript | typescript-language-server | LSP compliant | Slower |
| Python | pylsp | Lightweight | Less features |
| Python | pyright | Fast, Microsoft | Node dependency |
| Rust | rust-analyzer | Excellent | Heavy |
| Go | gopls | Official | Go only |

### Indexing Strategy
```typescript
// Option 1: In-memory (recommended for <10k files)
class InMemoryIndex {
  private symbols: Map<string, SymbolInfo>;
  private files: Map<string, FileSymbols>;
}

// Option 2: SQLite persistence (for >10k files)
class PersistentIndex {
  private db: Database;
  async query(sql: string): Promise<SymbolInfo[]>;
}

// Option 3: Hybrid (recommended)
class HybridIndex {
  private cache: LRUCache<string, SymbolInfo>;
  private db: Database; // for persistence
}
```

---

## Success Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Avg search time | 50ms | 5ms | Tool execution logs |
| Process spawns/session | 20 | 2 | Process monitoring |
| False positive rate | 15% | 2% | Manual review |
| LLM context tokens/search | 500 | 100 | Token counting |
| User satisfaction | N/A | +30% faster feeling | Subjective |

---

## Conclusion

**Verdict: Implement LSP for TypeScript, keep grep as fallback**

**Reasoning:**
1. **High ROI**: 1 week implementation → 10-100x speedup for common operations
2. **Low Risk**: Grep remains as fallback, no breaking changes
3. **Scalable**: Foundation for future language support
4. **Measurable**: Clear performance metrics to validate success

**Next Steps:**
1. ✅ Approved: Start Phase 1 (core infrastructure)
2. Benchmark current grep usage patterns
3. Implement tsserver wrapper
4. Build symbol index for TypeScript
5. Add new tools alongside grep
6. A/B test with real sessions
7. Measure and iterate

---

## Appendix: Code Sample

### Current grep usage in executor:
```typescript
case "grep":
  return await grepTool(toolArgs as { 
    pattern: string; 
    path?: string; 
    include?: string; 
    context?: number; 
    ignore_case?: boolean 
  });
```

### Proposed smart search:
```typescript
case "grep":
  // Try semantic search first if pattern looks like a symbol
  if (isSymbolPattern(toolArgs.pattern)) {
    const lspResult = await trySemanticSearch(toolArgs);
    if (lspResult) return lspResult;
  }
  return await grepTool(toolArgs);

case "find_symbol":
  return await findSymbol(toolArgs);
  
case "goto_definition":
  return await gotoDefinition(toolArgs);
```
