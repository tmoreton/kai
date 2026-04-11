import { useState } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  Trash2, 
  Plus, 
  AlertCircle,
  CheckCircle2,
  Bot,
  Terminal,
  Puzzle,
  Bell,
} from "lucide-react";
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { cn } from '../lib/utils';
import { toast } from './Toast';
import type { WorkflowStep, StepType } from './WorkflowEditor';

interface WorkflowStepEditorProps {
  steps: WorkflowStep[];
  onChange: (steps: WorkflowStep[]) => void;
}

type StepError = {
  field: string;
  message: string;
};

export function WorkflowStepEditor({ steps, onChange }: WorkflowStepEditorProps) {
  const [expandedStep, setExpandedStep] = useState<number | null>(0);
  const [validationErrors, setValidationErrors] = useState<Record<number, StepError[]>>({});

  const validateStep = (step: WorkflowStep): StepError[] => {
    const errors: StepError[] = [];
    
    if (!step.name || step.name.trim().length < 2) {
      errors.push({ field: 'name', message: 'Step name must be at least 2 characters' });
    }
    
    if (!step.type) {
      errors.push({ field: 'type', message: 'Step type is required' });
    }
    
    switch (step.type) {
      case 'llm':
        if (!step.prompt || step.prompt.trim().length < 10) {
          errors.push({ field: 'prompt', message: 'LLM step must have a prompt (min 10 chars)' });
        }
        break;
      case 'skill':
        if (!step.skill) {
          errors.push({ field: 'skill', message: 'Skill step must specify a skill ID' });
        }
        break;
      case 'shell':
        if (!step.command || step.command.trim().length === 0) {
          errors.push({ field: 'command', message: 'Shell step must have a command' });
        }
        break;
      case 'notify':
        if (!step.message) {
          errors.push({ field: 'message', message: 'Notify step must have a message' });
        }
        break;
    }
    
    return errors;
  };

  const validateAllSteps = (): boolean => {
    const allErrors: Record<number, StepError[]> = {};
    let hasErrors = false;
    
    steps.forEach((step, index) => {
      const errors = validateStep(step);
      if (errors.length > 0) {
        allErrors[index] = errors;
        hasErrors = true;
      }
    });
    
    setValidationErrors(allErrors);
    
    if (hasErrors) {
      toast.error('Validation failed', 'Please fix the errors in your workflow steps');
    }
    
    return !hasErrors;
  };

  const updateStep = (index: number, updates: Partial<WorkflowStep>) => {
    const newSteps = steps.map((step, i) => 
      i === index ? { ...step, ...updates } : step
    );
    onChange(newSteps);
    
    // Clear errors for this step
    if (validationErrors[index]) {
      const newErrors = { ...validationErrors };
      delete newErrors[index];
      setValidationErrors(newErrors);
    }
  };

  const addStep = () => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      name: 'New Step',
      type: 'llm',
      prompt: '',
    };
    onChange([...steps, newStep]);
    setExpandedStep(steps.length);
  };

  const removeStep = (index: number) => {
    if (steps.length <= 1) {
      toast.error('Cannot remove', 'Workflow must have at least one step');
      return;
    }
    const newSteps = steps.filter((_, i) => i !== index);
    onChange(newSteps);
    if (expandedStep === index) {
      setExpandedStep(null);
    }
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === steps.length - 1) return;
    
    const newSteps = [...steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    onChange(newSteps);
    setExpandedStep(targetIndex);
  };

  const getStepIcon = (type: StepType) => {
    switch (type) {
      case 'llm': return <Bot className="w-4 h-4" />;
      case 'skill': return <Puzzle className="w-4 h-4" />;
      case 'shell': return <Terminal className="w-4 h-4" />;
      case 'notify': return <Bell className="w-4 h-4" />;
      default: return <Bot className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-3">
      {/* Validate All Button */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">
          {steps.length} step{steps.length !== 1 ? 's' : ''}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={validateAllSteps}
          className="gap-2"
        >
          <CheckCircle2 className="w-4 h-4" />
          Validate All Steps
        </Button>
      </div>

      {/* Steps List */}
      {steps.map((step, index) => {
        const errors = validationErrors[index] || [];
        const hasErrors = errors.length > 0;
        const isExpanded = expandedStep === index;

        return (
          <div
            key={step.id}
            className={cn(
              "border rounded-lg overflow-hidden transition-colors",
              hasErrors ? "border-red-300 bg-red-50/50" : "border-border",
              isExpanded && "border-primary/50"
            )}
          >
            {/* Step Header */}
            <button
              onClick={() => setExpandedStep(isExpanded ? null : index)}
              className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center">
                  {index + 1}
                </span>
                {getStepIcon(step.type)}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{step.name}</div>
                <div className="text-xs text-muted-foreground capitalize">{step.type} step</div>
              </div>

              {hasErrors && (
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              )}
              
              <div className="flex items-center gap-1">
                {/* Move Buttons */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={index === 0}
                  onClick={(e) => { e.stopPropagation(); moveStep(index, 'up'); }}
                >
                  <ChevronUp className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={index === steps.length - 1}
                  onClick={(e) => { e.stopPropagation(); moveStep(index, 'down'); }}
                >
                  <ChevronDown className="w-4 h-4" />
                </Button>
                
                {/* Expand/Collapse */}
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
                
                {/* Delete */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                  onClick={(e) => { e.stopPropagation(); removeStep(index); }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="p-4 border-t bg-card space-y-4">
                {/* Error Summary */}
                {hasErrors && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        {errors.map((error, i) => (
                          <div key={i} className="text-sm text-red-700">
                            • {error.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Step Name */}
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Step Name</label>
                  <Input
                    value={step.name}
                    onChange={(e) => updateStep(index, { name: e.target.value })}
                    placeholder="Enter step name..."
                    className={cn(hasErrors && errors.some(e => e.field === 'name') && "border-red-300")}
                  />
                </div>

                {/* Step Type */}
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Step Type</label>
                  <div className="flex flex-wrap gap-2">
                    {(['llm', 'skill', 'shell', 'notify'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => {
                          const updates: Partial<WorkflowStep> = { type };
                          if (type === 'llm') updates.prompt = step.prompt || '';
                          if (type === 'skill') {
                            updates.skill = step.skill || '';
                            updates.tool = step.tool || '';
                          }
                          if (type === 'shell') updates.command = step.command || '';
                          if (type === 'notify') updates.message = step.message || '';
                          updateStep(index, updates);
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors",
                          step.type === type
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted hover:bg-muted/80"
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Type-Specific Fields */}
                {step.type === 'llm' && (
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Prompt</label>
                    <Textarea
                      value={step.prompt || ''}
                      onChange={(e) => updateStep(index, { prompt: e.target.value })}
                      placeholder="Enter the prompt for the AI..."
                      rows={6}
                      className={cn(
                        "font-mono text-sm",
                        hasErrors && errors.some(e => e.field === 'prompt') && "border-red-300"
                      )}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Use {'{{steps.X.output}}'} to reference previous step results
                    </p>
                  </div>
                )}

                {step.type === 'skill' && (
                  <>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Skill ID</label>
                      <Input
                        value={step.skill || ''}
                        onChange={(e) => updateStep(index, { skill: e.target.value })}
                        placeholder="e.g., youtube, twitter, data-storage"
                        className={cn(hasErrors && errors.some(e => e.field === 'skill') && "border-red-300")}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Tool/Action</label>
                      <Input
                        value={step.tool || ''}
                        onChange={(e) => updateStep(index, { tool: e.target.value })}
                        placeholder="e.g., post_tweet, get_uploads"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Parameters (JSON)</label>
                      <Textarea
                        value={step.parameters ? JSON.stringify(step.parameters, null, 2) : '{}'}
                        onChange={(e) => {
                          try {
                            const parameters = JSON.parse(e.target.value);
                            updateStep(index, { parameters });
                          } catch {
                            // Invalid JSON, ignore
                          }
                        }}
                        placeholder='{"key": "value"}'
                        rows={3}
                        className="font-mono text-sm"
                      />
                    </div>
                  </>
                )}

                {step.type === 'shell' && (
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Command</label>
                    <Textarea
                      value={step.command || ''}
                      onChange={(e) => updateStep(index, { command: e.target.value })}
                      placeholder="Enter shell command..."
                      rows={2}
                      className={cn(
                        "font-mono text-sm",
                        hasErrors && errors.some(e => e.field === 'command') && "border-red-300"
                      )}
                    />
                  </div>
                )}

                {step.type === 'notify' && (
                  <>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Message</label>
                      <Textarea
                        value={step.message || ''}
                        onChange={(e) => updateStep(index, { message: e.target.value })}
                        placeholder="Notification message"
                        rows={2}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Channel (optional)</label>
                      <Input
                        value={step.channel || ''}
                        onChange={(e) => updateStep(index, { channel: e.target.value })}
                        placeholder="e.g., email, slack"
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Add Step Button */}
      <Button
        variant="outline"
        onClick={addStep}
        className="w-full gap-2"
      >
        <Plus className="w-4 h-4" />
        Add Step
      </Button>
    </div>
  );
}
