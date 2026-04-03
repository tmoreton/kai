/**
 * Workflow Editor Component
 *
 * Visual editor for creating and editing agent workflows.
 * Supports skill-based steps with YAML preview.
 */

import { useState, useCallback } from 'react';
import { Plus, Trash2, ChevronDown, FileCode, Save, Eye } from 'lucide-react';
import YAML from 'yaml';
import { cn } from '../lib/utils';

// Available skills from ~/.kai/skills/
const AVAILABLE_SKILLS = [
  { id: 'data', name: 'Data Storage', description: 'Read/write JSON, Markdown, text files' },
  { id: 'youtube', name: 'YouTube Data', description: 'Search videos, get stats, channel info' },
  { id: 'browser', name: 'Browser', description: 'Navigate pages, click, fill forms' },
  { id: 'email', name: 'Email', description: 'Send and read emails' },
  { id: 'web-tools', name: 'Web Tools', description: 'Fetch URLs, search web' },
];

const STEP_TYPES = [
  { id: 'llm', name: 'LLM Call', description: 'AI language model prompt' },
  { id: 'skill', name: 'Skill', description: 'Execute a skill tool' },
  { id: 'shell', name: 'Shell', description: 'Run shell command' },
  { id: 'notify', name: 'Notify', description: 'Show notification' },
] as const;

type StepType = typeof STEP_TYPES[number]['id'];

interface WorkflowStep {
  name: string;
  type: StepType;
  skill?: string;
  action?: string;
  prompt?: string;
  command?: string;
  params?: Record<string, any>;
  output_var?: string;
}

interface WorkflowEditorProps {
  initialWorkflow?: {
    name: string;
    description?: string;
    steps: WorkflowStep[];
  };
  onSave: (yaml: string) => void;
  className?: string;
}

export function WorkflowEditor({ initialWorkflow, onSave, className }: WorkflowEditorProps) {
  const [name, setName] = useState(initialWorkflow?.name || 'New Workflow');
  const [description, setDescription] = useState(initialWorkflow?.description || '');
  const [steps, setSteps] = useState<WorkflowStep[]>(initialWorkflow?.steps || []);
  const [showYaml, setShowYaml] = useState(false);
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const addStep = useCallback(() => {
    const newStep: WorkflowStep = {
      name: `step-${steps.length + 1}`,
      type: 'llm',
      prompt: '',
      output_var: `result${steps.length + 1}`,
    };
    setSteps([...steps, newStep]);
    setActiveStep(steps.length);
  }, [steps]);

  const removeStep = useCallback((index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
    if (activeStep === index) setActiveStep(null);
  }, [steps, activeStep]);

  const updateStep = useCallback((index: number, updates: Partial<WorkflowStep>) => {
    setSteps(steps.map((step, i) => i === index ? { ...step, ...updates } : step));
  }, [steps]);

  const generateYaml = useCallback(() => {
    const workflow = {
      name,
      description,
      steps: steps.map(step => {
        const base = { name: step.name, type: step.type };
        if (step.output_var) base.output_var = step.output_var;
        
        switch (step.type) {
          case 'llm':
            return { ...base, prompt: step.prompt || '' };
          case 'skill':
            return { ...base, skill: step.skill || 'data', action: step.action || 'default', params: step.params || {} };
          case 'shell':
            return { ...base, command: step.command || '' };
          case 'notify':
            return { ...base, prompt: step.prompt || '' };
          default:
            return base;
        }
      }),
    };
    return YAML.stringify(workflow);
  }, [name, description, steps]);

  const handleSave = useCallback(() => {
    onSave(generateYaml());
  }, [generateYaml, onSave]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1 flex-1 mr-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full font-semibold text-lg bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-0"
            placeholder="Workflow Name"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full text-sm text-muted-foreground bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-0"
            placeholder="Description (optional)"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowYaml(!showYaml)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              showYaml 
                ? "bg-primary text-primary-foreground" 
                : "bg-secondary hover:bg-secondary/80"
            )}
          >
            {showYaml ? <Eye className="w-4 h-4" /> : <FileCode className="w-4 h-4" />}
            {showYaml ? 'Preview' : 'YAML'}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Save className="w-4 h-4" />
            Save
          </button>
        </div>
      </div>

      {showYaml ? (
        /* YAML Preview */
        <div className="relative">
          <pre className="bg-muted p-4 rounded-lg text-sm font-mono overflow-auto max-h-[500px]">
            {generateYaml()}
          </pre>
        </div>
      ) : (
        /* Visual Editor */
        <div className="space-y-3">
          {steps.map((step, index) => (
            <StepCard
              key={index}
              step={step}
              index={index}
              isActive={activeStep === index}
              onActivate={() => setActiveStep(index)}
              onUpdate={(updates) => updateStep(index, updates)}
              onRemove={() => removeStep(index)}
            />
          ))}
          
          <button
            onClick={addStep}
            className="w-full py-4 border-2 border-dashed border-border rounded-lg flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
          >
            <Plus className="w-5 h-5" />
            Add Step
          </button>
        </div>
      )}
    </div>
  );
}

/* Step Card Component */
interface StepCardProps {
  step: WorkflowStep;
  index: number;
  isActive: boolean;
  onActivate: () => void;
  onUpdate: (updates: Partial<WorkflowStep>) => void;
  onRemove: () => void;
}

function StepCard({ step, index, isActive, onActivate, onUpdate, onRemove }: StepCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const stepTypeInfo = STEP_TYPES.find(t => t.id === step.type);
  const skillInfo = AVAILABLE_SKILLS.find(s => s.id === step.skill);

  return (
    <div
      className={cn(
        "border rounded-lg transition-all",
        isActive ? "border-primary ring-1 ring-primary" : "border-border hover:border-border/80"
      )}
    >
      {/* Header */}
      <div 
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={() => { onActivate(); setIsExpanded(!isExpanded); }}
      >
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-xs font-medium">
          {index + 1}
        </span>
        
        <input
          type="text"
          value={step.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 font-medium bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-primary rounded px-2 py-1"
          placeholder="Step name"
        />
        
        <div className="flex items-center gap-2">
          <TypeBadge type={step.type} skill={step.skill} />
          <ChevronDown className={cn("w-4 h-4 transition-transform", isExpanded && "rotate-180")} />
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {/* Type Selector */}
          <div className="grid grid-cols-2 gap-2">
            {STEP_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => onUpdate({ type: type.id as StepType })}
                className={cn(
                  "p-2 rounded-md text-left text-sm transition-colors",
                  step.type === type.id
                    ? "bg-primary/10 border-primary border"
                    : "bg-secondary hover:bg-secondary/80 border border-transparent"
                )}
              >
                <div className="font-medium">{type.name}</div>
                <div className="text-xs text-muted-foreground">{type.description}</div>
              </button>
            ))}
          </div>

          {/* Skill Selector (for skill type) */}
          {step.type === 'skill' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Skill</label>
              <select
                value={step.skill || 'data'}
                onChange={(e) => onUpdate({ skill: e.target.value })}
                className="w-full p-2 rounded-md border bg-background"
              >
                {AVAILABLE_SKILLS.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name} - {skill.description}
                  </option>
                ))}
              </select>
              
              <label className="text-sm font-medium">Action</label>
              <input
                type="text"
                value={step.action || 'default'}
                onChange={(e) => onUpdate({ action: e.target.value })}
                className="w-full p-2 rounded-md border bg-background"
                placeholder="Action name (e.g., write_text, search_videos)"
              />

              <label className="text-sm font-medium">Params (JSON)</label>
              <textarea
                value={JSON.stringify(step.params || {}, null, 2)}
                onChange={(e) => {
                  try {
                    onUpdate({ params: JSON.parse(e.target.value) });
                  } catch {}
                }}
                className="w-full p-2 rounded-md border bg-background font-mono text-xs h-24"
                placeholder='{"file_path": "/tmp/output.txt", "content": "Hello"}'
              />
            </div>
          )}

          {/* Prompt (for LLM/notify) */}
          {(step.type === 'llm' || step.type === 'notify') && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Prompt</label>
              <textarea
                value={step.prompt || ''}
                onChange={(e) => onUpdate({ prompt: e.target.value })}
                className="w-full p-2 rounded-md border bg-background font-mono text-sm h-32"
                placeholder="Enter prompt text..."
              />
            </div>
          )}

          {/* Command (for shell) */}
          {step.type === 'shell' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Command</label>
              <input
                type="text"
                value={step.command || ''}
                onChange={(e) => onUpdate({ command: e.target.value })}
                className="w-full p-2 rounded-md border bg-background font-mono text-sm"
                placeholder="echo 'Hello World'"
              />
            </div>
          )}

          {/* Output Variable */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Output Variable (optional)</label>
            <input
              type="text"
              value={step.output_var || ''}
              onChange={(e) => onUpdate({ output_var: e.target.value })}
              className="w-full p-2 rounded-md border bg-background"
              placeholder="result1"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* Type Badge */
function TypeBadge({ type, skill }: { type: StepType; skill?: string }) {
  const colors: Record<StepType, string> = {
    llm: 'bg-blue-100 text-blue-800',
    skill: 'bg-green-100 text-green-800',
    shell: 'bg-yellow-100 text-yellow-800',
    notify: 'bg-purple-100 text-purple-800',
  };

  const labels: Record<StepType, string> = {
    llm: 'LLM',
    skill: skill ? `Skill:${skill}` : 'Skill',
    shell: 'Shell',
    notify: 'Notify',
  };

  return (
    <span className={cn("px-2 py-1 rounded-full text-xs font-medium", colors[type])}>
      {labels[type]}
    </span>
  );
}
