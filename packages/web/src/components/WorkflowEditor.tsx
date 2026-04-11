import React, { useState, useEffect } from "react";
import { 
  Plus, 
  Trash2, 
  Save, 
  FileCode2, 
  GripVertical,
  Bot,
  Terminal,
  Bell,
  Puzzle,
  ChevronDown,
  ChevronUp,
  X,
  FileEdit,
  Eye,
  Download,
  Sparkles,
  Wand2,
  Loader2
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Select } from "./ui/select";
import { cn } from "../lib/utils";

// Available skills from ~/.kai/skills/
const AVAILABLE_SKILLS = [
  { value: "data", label: "Data (read/write JSON, Markdown, text files)" },
  { value: "youtube", label: "YouTube (search and extract video info)" },
  { value: "browser", label: "Browser (web scraping, screenshots)" },
  { value: "email", label: "Email (send and manage emails)" },
  { value: "web-tools", label: "Web Tools (HTTP requests, web utilities)" },
];

export type StepType = "llm" | "skill" | "shell" | "notify";

export interface WorkflowStep {
  id: string;
  type: StepType;
  name: string;
  description?: string;
  // LLM step
  prompt?: string;
  systemPrompt?: string;
  // Skill step
  skill?: string;
  tool?: string;
  parameters?: Record<string, string>;
  // Shell step
  command?: string;
  workingDir?: string;
  // Notify step
  message?: string;
  channel?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: WorkflowStep[];
}

const STEP_TYPES: { value: StepType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: "llm", label: "LLM", icon: <Bot className="w-4 h-4" />, description: "AI language model call" },
  { value: "skill", label: "Skill", icon: <Puzzle className="w-4 h-4" />, description: "Execute a skill tool" },
  { value: "shell", label: "Shell", icon: <Terminal className="w-4 h-4" />, description: "Run shell command" },
  { value: "notify", label: "Notify", icon: <Bell className="w-4 h-4" />, description: "Send notification" },
];

// Generate unique ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
}

interface WorkflowEditorProps {
  initialWorkflow?: Workflow;
  onSave?: (workflow: Workflow, yamlContent: string) => void;
  readOnly?: boolean;
}

// Generate YAML from workflow
function generateYAML(workflow: Workflow): string {
  const lines: string[] = [];
  
  lines.push(`name: ${workflow.name}`);
  lines.push(`description: ${workflow.description}`);
  lines.push(`version: ${workflow.version}`);
  lines.push("");
  lines.push("steps:");
  
  workflow.steps.forEach((step, index) => {
    lines.push(`  - id: ${step.id}`);
    lines.push(`    type: ${step.type}`);
    lines.push(`    name: ${step.name}`);
    
    if (step.description) {
      lines.push(`    description: ${step.description}`);
    }
    
    switch (step.type) {
      case "llm":
        if (step.systemPrompt) {
          lines.push(`    system_prompt: |`);
          step.systemPrompt.split("\n").forEach(line => {
            lines.push(`      ${line}`);
          });
        }
        if (step.prompt) {
          lines.push(`    prompt: |`);
          step.prompt.split("\n").forEach(line => {
            lines.push(`      ${line}`);
          });
        }
        break;
        
      case "skill":
        if (step.skill) lines.push(`    skill: ${step.skill}`);
        if (step.tool) lines.push(`    tool: ${step.tool}`);
        if (step.parameters && Object.keys(step.parameters).length > 0) {
          lines.push(`    parameters:`);
          Object.entries(step.parameters).forEach(([key, value]) => {
            lines.push(`      ${key}: ${value}`);
          });
        }
        break;
        
      case "shell":
        if (step.command) lines.push(`    command: ${step.command}`);
        if (step.workingDir) lines.push(`    working_dir: ${step.workingDir}`);
        break;
        
      case "notify":
        if (step.channel) lines.push(`    channel: ${step.channel}`);
        if (step.message) {
          lines.push(`    message: |`);
          step.message.split("\n").forEach(line => {
            lines.push(`      ${line}`);
          });
        }
        break;
    }
    
    if (index < workflow.steps.length - 1) {
      lines.push("");
    }
  });
  
  return lines.join("\n");
}

// Parse YAML to workflow (basic parser)
function parseYAML(yamlContent: string): Partial<Workflow> {
  const lines = yamlContent.split("\n");
  const workflow: Partial<Workflow> = {
    steps: [],
  };
  
  let currentStep: Partial<WorkflowStep> | null = null;
  let currentSection: string | null = null;
  let indentLevel = 0;
  let inMultiline = false;
  let multilineKey = "";
  let multilineContent: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (!trimmed || trimmed.startsWith("#")) continue;
    
    // Check if we're ending a multiline block
    if (inMultiline) {
      const currentIndent = line.length - line.trimStart().length;
      if (currentIndent <= indentLevel && trimmed) {
        // End of multiline
        if (currentStep) {
          (currentStep as Record<string, string>)[multilineKey] = multilineContent.join("\n");
        }
        inMultiline = false;
        multilineKey = "";
        multilineContent = [];
        // Continue processing this line
      } else {
        multilineContent.push(line.slice(indentLevel + 2));
        continue;
      }
    }
    
    // Top-level fields
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      const [key, ...valueParts] = trimmed.split(":");
      const value = valueParts.join(":").trim();
      
      if (key === "name") workflow.name = value;
      else if (key === "description") workflow.description = value;
      else if (key === "version") workflow.version = value;
      continue;
    }
    
    // Steps section
    const indent = line.length - line.trimStart().length;
    
    if (indent === 2 && trimmed.startsWith("- ")) {
      // New step
      if (currentStep && workflow.steps) {
        workflow.steps.push(currentStep as WorkflowStep);
      }
      currentStep = { id: generateId(), type: "llm", name: "" };
      currentSection = null;
    }
    
    if (!currentStep) continue;
    
    // Step fields (indent 4+)
    if (indent >= 4) {
      const [key, ...valueParts] = trimmed.split(":");
      const value = valueParts.join(":").trim();
      
      if (value === "|") {
        // Start of multiline
        inMultiline = true;
        multilineKey = key;
        indentLevel = indent;
        multilineContent = [];
      } else if (key === "id") currentStep.id = value || generateId();
      else if (key === "type") currentStep.type = value as StepType;
      else if (key === "name") currentStep.name = value;
      else if (key === "description") currentStep.description = value;
      else if (key === "skill") currentStep.skill = value;
      else if (key === "tool") currentStep.tool = value;
      else if (key === "command") currentStep.command = value;
      else if (key === "working_dir") currentStep.workingDir = value;
      else if (key === "channel") currentStep.channel = value;
      else if (key === "message") currentStep.message = value;
      else if (key === "system_prompt") currentStep.systemPrompt = value;
      else if (key === "prompt") currentStep.prompt = value;
      else if (key === "parameters") {
        currentStep.parameters = {};
        currentSection = "parameters";
      } else if (currentSection === "parameters" && indent === 6) {
        if (!currentStep.parameters) currentStep.parameters = {};
        currentStep.parameters[key] = value;
      }
    }
  }
  
  // Add last step
  if (currentStep && workflow.steps) {
    workflow.steps.push(currentStep as WorkflowStep);
  }
  
  return workflow;
}

function createDefaultStep(type: StepType): WorkflowStep {
  const base = {
    id: generateId(),
    type,
    name: `New ${type} step`,
    description: "",
  };
  
  switch (type) {
    case "llm":
      return { ...base, prompt: "", systemPrompt: "" };
    case "skill":
      return { ...base, skill: "data", tool: "", parameters: {} };
    case "shell":
      return { ...base, command: "", workingDir: "" };
    case "notify":
      return { ...base, message: "", channel: "default" };
    default:
      return base as WorkflowStep;
  }
}

// Step Editor Component
interface StepEditorProps {
  step: WorkflowStep;
  onUpdate: (step: WorkflowStep) => void;
  onRemove: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  index: number;
}

function StepEditor({ step, onUpdate, onRemove, isExpanded, onToggleExpand, index }: StepEditorProps) {
  const stepType = STEP_TYPES.find(t => t.value === step.type);
  
  const handleChange = (updates: Partial<WorkflowStep>) => {
    onUpdate({ ...step, ...updates });
  };

  const addParameter = () => {
    const key = prompt("Parameter name:");
    if (key) {
      const newParams = { ...(step.parameters || {}), [key]: "" };
      handleChange({ parameters: newParams });
    }
  };

  const removeParameter = (key: string) => {
    const newParams = { ...(step.parameters || {}) };
    delete newParams[key];
    handleChange({ parameters: newParams });
  };

  const updateParameter = (key: string, newKey: string, value: string) => {
    const newParams: Record<string, string> = {};
    Object.entries(step.parameters || {}).forEach(([k, v]) => {
      if (k === key) {
        newParams[newKey] = value;
      } else {
        newParams[k] = v;
      }
    });
    handleChange({ parameters: newParams });
  };

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Step Header */}
      <div 
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={onToggleExpand}
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground w-6">{index + 1}</span>
        <div className={cn(
          "flex items-center gap-2 px-2 py-1 rounded text-xs font-medium",
          step.type === "llm" && "bg-blue-500/10 text-blue-600",
          step.type === "skill" && "bg-purple-500/10 text-purple-600",
          step.type === "shell" && "bg-orange-500/10 text-orange-600",
          step.type === "notify" && "bg-green-500/10 text-green-600",
        )}>
          {stepType?.icon}
          {stepType?.label}
        </div>
        <div className="flex-1 min-w-0">
          <Input
            value={step.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange({ name: e.target.value })}
            className="h-7 text-sm bg-transparent border-0 px-0 focus-visible:ring-0"
            placeholder="Step name..."
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onRemove();
          }}
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
        {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </div>

      {/* Step Details */}
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-border">
          <div className="pt-3 space-y-3">
            {/* Common Fields */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Description</label>
              <Input
                value={step.description || ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange({ description: e.target.value })}
                placeholder="Step description..."
                className="h-8 text-sm"
              />
            </div>

            {/* Type-Specific Fields */}
            {step.type === "llm" && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">System Prompt</label>
                  <Textarea
                    value={step.systemPrompt || ""}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange({ systemPrompt: e.target.value })}
                    placeholder="System instructions for the LLM..."
                    className="min-h-[60px] text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Prompt</label>
                  <Textarea
                    value={step.prompt || ""}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange({ prompt: e.target.value })}
                    placeholder="User prompt with {{variables}}..."
                    className="min-h-[80px] text-sm font-mono"
                  />
                </div>
              </>
            )}

            {step.type === "skill" && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Skill</label>
                  <Select
                    value={step.skill || ""}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleChange({ skill: e.target.value, tool: "" })}
                    options={AVAILABLE_SKILLS}
                    className="h-8 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Select a skill from ~/.kai/skills/
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Tool</label>
                  <Input
                    value={step.tool || ""}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange({ tool: e.target.value })}
                    placeholder="Tool name (e.g., read_json, write_markdown)..."
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Parameters</label>
                  <div className="space-y-2">
                    {Object.entries(step.parameters || {}).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2">
                        <Input
                          value={key}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateParameter(key, e.target.value, value)}
                          placeholder="Key"
                          className="h-7 text-sm flex-1"
                        />
                        <Input
                          value={value}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateParameter(key, key, e.target.value)}
                          placeholder="Value"
                          className="h-7 text-sm flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeParameter(key)}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addParameter}
                      className="h-7 text-xs"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add Parameter
                    </Button>
                  </div>
                </div>
              </>
            )}

            {step.type === "shell" && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Command</label>
                  <Textarea
                    value={step.command || ""}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange({ command: e.target.value })}
                    placeholder="Shell command to execute..."
                    className="min-h-[60px] text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Working Directory (optional)</label>
                  <Input
                    value={step.workingDir || ""}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange({ workingDir: e.target.value })}
                    placeholder="./relative/path or /absolute/path"
                    className="h-8 text-sm"
                  />
                </div>
              </>
            )}

            {step.type === "notify" && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Channel</label>
                  <Input
                    value={step.channel || ""}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange({ channel: e.target.value })}
                    placeholder="Notification channel (e.g., slack, email, desktop)..."
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Message</label>
                  <Textarea
                    value={step.message || ""}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange({ message: e.target.value })}
                    placeholder="Notification message with {{variables}}..."
                    className="min-h-[60px] text-sm"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Main Workflow Editor Component
export function WorkflowEditor({ initialWorkflow, onSave, readOnly = false }: WorkflowEditorProps) {
  const [workflow, setWorkflow] = useState<Workflow>(() => {
    if (initialWorkflow) return initialWorkflow;
    return {
      id: generateId(),
      name: "New Workflow",
      description: "",
      version: "1.0.0",
      steps: [],
    };
  });

  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [yamlContent, setYamlContent] = useState("");
  const [aiEditing, setAiEditing] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  // Update YAML preview whenever workflow changes
  useEffect(() => {
    const yaml = generateYAML(workflow);
    setYamlContent(yaml);
  }, [workflow]);

  const handleAddStep = (type: StepType) => {
    const newStep = createDefaultStep(type);
    setWorkflow(prev => ({
      ...prev,
      steps: [...prev.steps, newStep],
    }));
    setExpandedSteps(prev => new Set(prev).add(newStep.id));
  };

  const handleUpdateStep = (index: number, updatedStep: WorkflowStep) => {
    setWorkflow(prev => ({
      ...prev,
      steps: prev.steps.map((s, i) => i === index ? updatedStep : s),
    }));
  };

  const handleRemoveStep = (index: number) => {
    setWorkflow(prev => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index),
    }));
  };

  const handleToggleExpand = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const handleSave = () => {
    if (onSave) {
      onSave(workflow, yamlContent);
    }
  };

  const handleLoadFromYAML = () => {
    const input = prompt("Paste YAML content:");
    if (input) {
      const parsed = parseYAML(input);
      if (parsed.steps && parsed.steps.length > 0) {
        setWorkflow(prev => ({
          ...prev,
          name: parsed.name || prev.name,
          description: parsed.description || prev.description,
          version: parsed.version || prev.version,
          steps: parsed.steps || [],
        }));
      }
    }
  };

  const handleDownload = () => {
    const blob = new Blob([yamlContent], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflow.name.toLowerCase().replace(/\s+/g, "_")}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleAIEdit = async () => {
    if (!aiPrompt.trim()) return;
    setAiEditing(true);
    
    try {
      const response = await fetch('/api/agents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          description: `Modify this workflow: ${workflow.name}. ${aiPrompt}\n\nCurrent workflow:\n${yamlContent}` 
        }),
      });
      
      if (!response.ok) throw new Error('Failed to generate');
      
      const result = await response.json();
      
      // Convert generated steps to workflow format
      const newSteps = result.steps.map((s: any) => ({
        id: generateId(),
        type: s.type,
        name: s.name,
        description: s.description || '',
        prompt: s.prompt,
        skill: s.skill,
        tool: s.action,
        parameters: s.params,
        command: s.command,
      }));
      
      setWorkflow(prev => ({
        ...prev,
        name: result.name || prev.name,
        description: result.description || prev.description,
        steps: newSteps.length > 0 ? newSteps : prev.steps,
      }));
      
      setAiPrompt('');
      alert('Workflow updated with AI suggestions!');
    } catch (err) {
      alert('Failed to update with AI: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setAiEditing(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <FileCode2 className="w-6 h-6 text-primary" />
          <div>
            <Input
              value={workflow.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWorkflow(prev => ({ ...prev, name: e.target.value }))}
              className="h-8 text-lg font-semibold bg-transparent border-0 px-0 focus-visible:ring-0 w-64"
              placeholder="Workflow name..."
              disabled={readOnly}
            />
            <Input
              value={workflow.description}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWorkflow(prev => ({ ...prev, description: e.target.value }))}
              className="h-6 text-sm text-muted-foreground bg-transparent border-0 px-0 focus-visible:ring-0 w-96"
              placeholder="Workflow description..."
              disabled={readOnly}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAiEditing(!aiEditing)}
            disabled={readOnly}
          >
            <Sparkles className="w-4 h-4 mr-1.5" />
            AI Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadFromYAML}
            disabled={readOnly}
          >
            <FileEdit className="w-4 h-4 mr-1.5" />
            Load YAML
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            <Eye className="w-4 h-4 mr-1.5" />
            {showPreview ? "Hide Preview" : "Preview YAML"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
          >
            <Download className="w-4 h-4 mr-1.5" />
            Download
          </Button>
          {onSave && (
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={readOnly}
            >
              <Save className="w-4 h-4 mr-1.5" />
              Save Workflow
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Steps Panel */}
        <div className={cn(
          "flex-1 overflow-y-auto p-4",
          showPreview && "w-1/2"
        )}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Workflow Steps</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {workflow.steps.length} step{workflow.steps.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Add step:</span>
                  <div className="flex gap-1">
                    {STEP_TYPES.map((type) => (
                      <Button
                        key={type.value}
                        variant="outline"
                        size="sm"
                        onClick={() => handleAddStep(type.value)}
                        disabled={readOnly}
                        className="h-8 px-2"
                        title={type.description}
                      >
                        {type.icon}
                        <span className="ml-1.5 text-xs">{type.label}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* AI Edit Panel */}
              {aiEditing && (
                <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Wand2 className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">AI Workflow Assistant</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Describe what changes you want to make to this workflow. AI will suggest modifications.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="e.g., Add a step to send email after completion, or remove the shell command step..."
                      className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:border-primary"
                      disabled={aiEditing && !aiPrompt}
                    />
                    <Button
                      size="sm"
                      onClick={handleAIEdit}
                      disabled={!aiPrompt.trim() || aiEditing}
                    >
                      {aiEditing ? (
                        <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4 mr-1.5" />
                      )}
                      {aiEditing ? 'Generating...' : 'Update with AI'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAiEditing(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {workflow.steps.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-border rounded-lg">
                  <div className="flex justify-center gap-3 mb-4">
                    {STEP_TYPES.map((type) => (
                      <button
                        key={type.value}
                        onClick={() => handleAddStep(type.value)}
                        disabled={readOnly}
                        className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border hover:border-primary hover:bg-accent/30 transition-colors disabled:opacity-50"
                      >
                        <div className={cn(
                          "p-2 rounded-lg",
                          type.value === "llm" && "bg-blue-500/10 text-blue-600",
                          type.value === "skill" && "bg-purple-500/10 text-purple-600",
                          type.value === "shell" && "bg-orange-500/10 text-orange-600",
                          type.value === "notify" && "bg-green-500/10 text-green-600",
                        )}>
                          {type.icon}
                        </div>
                        <span className="text-xs font-medium">{type.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Click a step type above to add your first step
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {workflow.steps.map((step, index) => (
                    <div key={step.id} className="relative">
                      {index > 0 && (
                        <div className="absolute -top-3 left-8 w-px h-3 bg-border" />
                      )}
                      <StepEditor
                        step={step}
                        index={index}
                        isExpanded={expandedSteps.has(step.id)}
                        onToggleExpand={() => handleToggleExpand(step.id)}
                        onUpdate={(updated) => handleUpdateStep(index, updated)}
                        onRemove={() => handleRemoveStep(index)}
                      />
                      {index < workflow.steps.length - 1 && (
                        <div className="absolute -bottom-3 left-8 w-px h-3 bg-border" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* YAML Preview Panel */}
        {showPreview && (
          <div className="w-1/2 border-l border-border overflow-y-auto p-4 bg-secondary">
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileCode2 className="w-5 h-5" />
                  YAML Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="h-full">
                <pre className="text-xs font-mono bg-card p-4 rounded-lg overflow-auto whitespace-pre-wrap border border-border h-[calc(100%-2rem)]">
                  {yamlContent}
                </pre>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkflowEditor;
