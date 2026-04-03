# Workflow UI Architecture Design

## Overview

This document outlines the architecture for the workflow UI system in Kai, designed to support the new skill-based workflows with durable execution, real-time updates, and clean state management.

## 1. Component Hierarchy

```
WorkflowEditor (Container)
├── WorkflowHeader
│   ├── WorkflowInfo (name, description, schedule)
│   ├── RunControls (run, pause, resume)
│   └── WorkflowActions (save, duplicate, delete)
├── WorkflowCanvas (Droppable area)
│   ├── StepCard[]
│   │   ├── StepHeader (name, type badge, drag handle)
│   │   ├── SkillSelector (if type=skill)
│   │   ├── ParamEditor (dynamic based on skill/tool)
│   │   ├── ConditionEditor (optional condition)
│   │   └── OutputConfig (output_var mapping)
│   └── ConnectionLines (visual step flow)
├── WorkflowSidebar
│   ├── StepPalette (draggable step types)
│   │   ├── LLMStepTemplate
│   │   ├── SkillStepTemplate
│   │   ├── ShellStepTemplate
│   │   ├── NotifyStepTemplate
│   │   └── ParallelStepTemplate
│   └── SkillLibraryPanel
│       ├── SkillCard[]
│       └── SkillSearch/Filter
└── WorkflowInspector (Right panel)
    ├── StepDetails (selected step config)
    ├── WorkflowVariables (vars viewer)
    └── ExecutionHistory (mini run list)
```

### Key Components

#### WorkflowEditor
Main container managing the workflow state and coordinating between child components. Uses React DnD for drag-and-drop step reordering.

```typescript
interface WorkflowEditorProps {
  agentId: string;
  readOnly?: boolean;
  onSave?: (workflow: WorkflowDefinition) => void;
}
```

#### StepCard
Visual representation of a workflow step. Supports:
- Drag-and-drop reordering
- Expandable/collapsible details
- Type-specific icons and colors
- Status indicators during execution

```typescript
interface StepCardProps {
  step: WorkflowStep;
  index: number;
  isSelected: boolean;
  isExecuting: boolean;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  onSelect: () => void;
  onUpdate: (step: WorkflowStep) => void;
  onDelete: () => void;
  onMove: (dragIndex: number, hoverIndex: number) => void;
}
```

#### SkillSelector
Searchable dropdown for selecting skills from the skill registry. Shows:
- Skill name and description
- Available tools/actions
- Version info
- Validation status

```typescript
interface SkillSelectorProps {
  value?: string;
  onChange: (skillId: string, action?: string) => void;
  filter?: 'all' | 'llm' | 'integration' | 'shell';
}
```

## 2. State Management

### Zustand Store: `workflowStore.ts`

```typescript
interface WorkflowState {
  // Current workflow
  workflow: WorkflowDefinition | null;
  originalWorkflow: WorkflowDefinition | null; // For dirty check
  
  // Selection
  selectedStepIndex: number | null;
  
  // Execution state
  isRunning: boolean;
  isPaused: boolean;
  currentRunId: string | null;
  stepStatuses: Record<string, StepStatus>;
  
  // UI state
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  zoom: number;
  
  // Actions
  loadWorkflow: (agentId: string) => Promise<void>;
  saveWorkflow: () => Promise<void>;
  updateStep: (index: number, step: WorkflowStep) => void;
  addStep: (step: WorkflowStep, index?: number) => void;
  deleteStep: (index: number) => void;
  reorderSteps: (from: number, to: number) => void;
  selectStep: (index: number | null) => void;
  
  // Execution actions
  startRun: () => Promise<void>;
  pauseRun: () => Promise<void>;
  resumeRun: () => Promise<void>;
  updateStepStatus: (stepName: string, status: StepStatus) => void;
  
  // Computed
  isDirty: boolean;
  canSave: boolean;
  canRun: boolean;
}
```

### React Query Integration

```typescript
// Workflow queries
export const workflowQueries = {
  detail: (agentId: string) =>
    queryOptions({
      queryKey: ['workflows', agentId],
      queryFn: () => api.agents.getWorkflow(agentId),
      staleTime: 30000,
    }),
    
  execution: (runId: string) =>
    queryOptions({
      queryKey: ['workflow-execution', runId],
      queryFn: () => api.agents.getRunSteps(runId),
      refetchInterval: (query) => 
        query.state.data?.status === 'running' ? 2000 : false,
    }),
};
```

### State Flow

1. **Loading**: `loadWorkflow()` → API call → Parse YAML → Set workflow state
2. **Editing**: User edits → `updateStep()` → Mark dirty → Debounced auto-save (optional)
3. **Saving**: `saveWorkflow()` → Serialize to YAML → API PUT → Clear dirty
4. **Running**: `startRun()` → API POST → Set runId → Poll/SSE for updates
5. **Real-time**: WebSocket/SSE updates → `updateStepStatus()` → UI refresh

## 3. API Integration

### Extended API Client (`api/client.ts`)

```typescript
// Workflow management
export const workflowsApi = {
  get: (agentId: string): Promise<WorkflowDefinition> => {
    return fetchJson(`${API_BASE}/agents/${agentId}/workflow`);
  },
  
  update: (agentId: string, workflow: WorkflowDefinition): Promise<void> => {
    return fetchJson(`${API_BASE}/agents/${agentId}/workflow`, {
      method: 'PUT',
      body: JSON.stringify(workflow),
    });
  },
  
  validate: (workflow: WorkflowDefinition): Promise<ValidationResult> => {
    return fetchJson(`${API_BASE}/workflows/validate`, {
      method: 'POST',
      body: JSON.stringify(workflow),
    });
  },
};

// Execution control
export const executionApi = {
  start: (agentId: string): Promise<{ runId: string }> => {
    return fetchJson(`${API_BASE}/agents/${agentId}/run`, {
      method: 'POST',
    });
  },
  
  pause: (runId: string): Promise<void> => {
    return fetchJson(`${API_BASE}/runs/${runId}/pause`, { method: 'POST' });
  },
  
  resume: (runId: string): Promise<void> => {
    return fetchJson(`${API_BASE}/runs/${runId}/resume`, { method: 'POST' });
  },
  
  cancel: (runId: string): Promise<void> => {
    return fetchJson(`${API_BASE}/runs/${runId}/cancel`, { method: 'POST' });
  },
  
  getStatus: (runId: string): Promise<ExecutionStatus> => {
    return fetchJson(`${API_BASE}/runs/${runId}/status`);
  },
  
  getSteps: (runId: string): Promise<StepExecution[]> => {
    return fetchJson(`${API_BASE}/runs/${runId}/steps`);
  },
  
  // Server-Sent Events for real-time updates
  subscribe: (runId: string): EventSource => {
    return new EventSource(`${API_BASE}/runs/${runId}/events`);
  },
};

// Checkpoint/Resume
export const checkpointApi = {
  getCheckpoints: (runId: string): Promise<Checkpoint[]> => {
    return fetchJson(`${API_BASE}/runs/${runId}/checkpoints`);
  },
  
  resumeFromCheckpoint: (runId: string, checkpointId: number): Promise<void> => {
    return fetchJson(`${API_BASE}/runs/${runId}/resume`, {
      method: 'POST',
      body: JSON.stringify({ checkpointId }),
    });
  },
};
```

### Backend Route Extensions

Add to `src/web/routes/agents.ts`:

```typescript
// Execution control endpoints
app.post("/api/runs/:runId/pause", async (c) => {
  const runId = c.req.param("runId");
  // Signal pause to running workflow
  return c.json({ paused: true });
});

app.post("/api/runs/:runId/resume", async (c) => {
  const runId = c.req.param("runId");
  // Resume from last checkpoint
  const result = await resumeRun(runId);
  return c.json({ resumed: true, runId });
});

app.get("/api/runs/:runId/status", (c) => {
  const run = getRun(c.req.param("runId"));
  if (!run) return c.json({ error: "Run not found" }, 404);
  return c.json({
    runId: run.id,
    status: run.status,
    currentStep: run.current_step,
    startedAt: run.started_at,
    completedAt: run.completed_at,
  });
});

// Server-Sent Events for real-time updates
app.get("/api/runs/:runId/events", (c) => {
  const runId = c.req.param("runId");
  
  return new Response(
    new ReadableStream({
      start(controller) {
        // Subscribe to event bus
        const unsubscribe = eventBus.subscribe(
          (e) => e.type.startsWith("agent:") && e.payload.runId === runId,
          (event) => {
            controller.enqueue(`event: ${event.type}\n`);
            controller.enqueue(`data: ${JSON.stringify(event.payload)}\n\n`);
          }
        );
        
        // Clean up on close
        c.req.raw.signal.addEventListener("abort", () => {
          unsubscribe();
          controller.close();
        });
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    }
  );
});
```

## 4. Real-Time Updates

### SSE Implementation

```typescript
// hooks/useWorkflowEvents.ts
export function useWorkflowEvents(runId: string | null) {
  const queryClient = useQueryClient();
  
  useEffect(() => {
    if (!runId) return;
    
    const eventSource = executionApi.subscribe(runId);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'step:start':
          queryClient.setQueryData(['workflow-execution', runId], (old: any) => ({
            ...old,
            stepStatuses: { ...old.stepStatuses, [data.step]: 'running' },
          }));
          break;
          
        case 'step:complete':
          queryClient.setQueryData(['workflow-execution', runId], (old: any) => ({
            ...old,
            stepStatuses: { ...old.stepStatuses, [data.step]: 'completed' },
            vars: { ...old.vars, [data.outputVar]: data.result },
          }));
          break;
          
        case 'step:error':
          queryClient.setQueryData(['workflow-execution', runId], (old: any) => ({
            ...old,
            stepStatuses: { ...old.stepStatuses, [data.step]: 'failed' },
            error: data.error,
          }));
          break;
          
        case 'run:complete':
        case 'run:failed':
          queryClient.invalidateQueries({ queryKey: ['workflow-execution', runId] });
          break;
      }
    };
    
    eventSource.onerror = () => {
      // Auto-reconnect with backoff
      eventSource.close();
    };
    
    return () => eventSource.close();
  }, [runId, queryClient]);
}
```

### Event Types

```typescript
type WorkflowEvent =
  | { type: 'step:start'; step: string; index: number }
  | { type: 'step:complete'; step: string; outputVar: string; result: any }
  | { type: 'step:error'; step: string; error: string }
  | { type: 'step:skipped'; step: string; reason: string }
  | { type: 'run:pause'; checkpointId: number }
  | { type: 'run:resume'; fromCheckpointId: number }
  | { type: 'run:complete'; results: Record<string, any> }
  | { type: 'run:failed'; error: string; canResume: boolean }
  | { type: 'checkpoint:saved'; checkpointId: number; stepIndex: number };
```

## 5. Durable Execution State Display

### Checkpoint Visualization

```typescript
// components/CheckpointTimeline.tsx
interface CheckpointTimelineProps {
  checkpoints: Checkpoint[];
  currentStepIndex: number;
  onResumeFrom?: (checkpointId: number) => void;
}

function CheckpointTimeline({ checkpoints, currentStepIndex, onResumeFrom }: CheckpointTimelineProps) {
  return (
    <div className="checkpoint-timeline">
      {checkpoints.map((cp) => (
        <CheckpointNode
          key={cp.id}
          checkpoint={cp}
          isActive={cp.stepIndex === currentStepIndex}
          isPast={cp.stepIndex < currentStepIndex}
          onResume={() => onResumeFrom?.(cp.id)}
        />
      ))}
    </div>
  );
}
```

### Run Details Panel

```typescript
// components/RunDetailsPanel.tsx
interface RunDetailsPanelProps {
  runId: string;
  onResume?: () => void;
  onCancel?: () => void;
}

function RunDetailsPanel({ runId, onResume, onCancel }: RunDetailsPanelProps) {
  const { data: run } = useSuspenseQuery(workflowQueries.execution(runId));
  const checkpoints = useSuspenseQuery(checkpointQueries.list(runId));
  
  return (
    <div className="run-details">
      <RunHeader 
        status={run.status} 
        startedAt={run.startedAt}
        canResume={run.status === 'paused' || checkpoints.data?.length > 0}
      />
      
      <CheckpointTimeline 
        checkpoints={checkpoints.data || []}
        currentStepIndex={run.currentStep}
        onResumeFrom={(cpId) => checkpointApi.resumeFromCheckpoint(runId, cpId)}
      />
      
      <StepExecutionList steps={run.steps} />
      
      {run.status === 'paused' && (
        <div className="resume-prompt">
          <p>Workflow paused at checkpoint {run.currentStep}</p>
          <Button onClick={onResume}>Resume</Button>
        </div>
      )}
    </div>
  );
}
```

### Durable Execution States

| State | Visual Indicator | User Action |
|-------|-----------------|-------------|
| Running | Pulse animation on active step | Cancel button |
| Paused | Yellow highlight, pause icon | Resume/Restart |
| Failed | Red step, error message | Retry from checkpoint |
| Completed | Green checkmark, summary | View results |
| Crashed | Orange warning, auto-recovery notice | Resume from last checkpoint |

## 6. Skill-Based Workflow Integration

### Skill Registry Integration

```typescript
// hooks/useSkills.ts
export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => api.settings.get(),
    select: (data) => data.skills,
  });
}

// Skill parameter validation
export function useSkillParams(skillId: string, action?: string) {
  return useQuery({
    queryKey: ['skill-params', skillId, action],
    queryFn: async () => {
      const skill = await api.settings.getSkill(skillId);
      const tool = skill.tools.find(t => t.name === action);
      return tool?.parameters || {};
    },
    enabled: !!skillId && !!action,
  });
}
```

### Dynamic Param Editor

```typescript
// components/ParamEditor.tsx
interface ParamEditorProps {
  schema: JSONSchema;
  value: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
  context?: WorkflowContext; // For ${vars.x} interpolation
}

function ParamEditor({ schema, value, onChange, context }: ParamEditorProps) {
  return (
    <div className="param-editor">
      {Object.entries(schema.properties).map(([key, prop]) => (
        <ParamField
          key={key}
          name={key}
          schema={prop}
          value={value[key]}
          onChange={(v) => onChange({ ...value, [key]: v })}
          context={context}
        />
      ))}
    </div>
  );
}
```

## 7. File Structure

```
packages/web/src/
├── components/
│   └── workflow/
│       ├── WorkflowEditor.tsx      # Main container
│       ├── WorkflowCanvas.tsx      # Drag-drop canvas
│       ├── WorkflowHeader.tsx      # Toolbar
│       ├── StepCard.tsx            # Step component
│       ├── SkillSelector.tsx       # Skill picker
│       ├── ParamEditor.tsx         # Dynamic params
│       ├── ConnectionLines.tsx     # Visual connections
│       ├── CheckpointTimeline.tsx  # Durable state
│       ├── RunDetailsPanel.tsx     # Execution view
│       └── ExecutionLog.tsx        # Step logs
├── hooks/
│   ├── useWorkflow.ts              # Core workflow hook
│   ├── useWorkflowEvents.ts        # SSE hook
│   ├── useSkills.ts                # Skills data
│   └── useDragDrop.ts              # DnD helpers
├── stores/
│   └── workflowStore.ts            # Zustand store
├── api/
│   └── client.ts                   # Extended API (existing)
├── types/
│   └── workflow.ts                 # Type definitions
└── lib/
    └── workflow-utils.ts           # Parsing, validation
```

## 8. Implementation Phases

### Phase 1: Core Editor (MVP)
- [ ] `WorkflowEditor` container component
- [ ] `StepCard` with basic step types (llm, shell, skill)
- [ ] YAML load/save via existing API
- [ ] Simple drag-and-drop reordering
- [ ] Basic run/start via existing API

### Phase 2: Execution View
- [ ] `RunDetailsPanel` for viewing runs
- [ ] Step status visualization
- [ ] SSE integration for real-time updates
- [ ] Execution log viewer

### Phase 3: Durable Execution
- [ ] Checkpoint visualization
- [ ] Pause/Resume UI
- [ ] Resume from checkpoint flow
- [ ] Error recovery UI

### Phase 4: Advanced Features
- [ ] Skill parameter editor with validation
- [ ] Workflow variable viewer/debugger
- [ ] Parallel step visualization
- [ ] Workflow validation/linting

## 9. Key Design Decisions

1. **State Management**: Zustand for local UI state, React Query for server state
2. **Real-time**: SSE over WebSocket (simpler, auto-reconnect, HTTP-compatible)
3. **Drag/Drop**: @dnd-kit/core (modern, accessible, lightweight)
4. **YAML Editing**: Visual editor only (no raw YAML mode initially)
5. **Skill Discovery**: Auto-populate from `/api/settings` endpoint
6. **Validation**: Server-side validation with client-side caching
7. **Dirty State**: Track at store level, prompt on navigate if unsaved

## 10. Integration Points

- **Existing**: `AgentDetail.tsx` workflows tab → Replace `EmbeddedWorkflowEditor`
- **Existing**: `api/client.ts` → Add `workflowsApi` and `executionApi`
- **Existing**: `router.tsx` → Add `/workflows/:agentId/run/:runId` route
- **Backend**: Extend `agents.ts` routes with checkpoint/resume endpoints
- **Backend**: Add SSE event publishing to `event-bus.ts`
