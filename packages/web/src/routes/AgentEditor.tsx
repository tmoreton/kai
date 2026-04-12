import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Sparkles, 
  Bot,
  ArrowLeft,
  Loader2,
  Wand2,
  CheckCircle2,
  Brain,
  Target,
  StickyNote,
  UserCircle,
  Clock,
  Play,
  ChevronDown,
  ChevronUp,
  Download,
  Plus,
  FileCode,
  AlertCircle,
} from "lucide-react";
import { agentsApi } from '../api/client';
import { agentsQueries } from '../api/queries';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { toast } from '../components/Toast';
import { cn } from '../lib/utils';
import type { WorkflowStep } from '../components/WorkflowEditor';
import { WorkflowStepEditor } from '../components/WorkflowStepEditor';
import YAML from 'js-yaml';

// ============================================
// Types
// ============================================

interface SkillTool {
  name: string;
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    required?: boolean;
  }>;
}

interface CreateSkill {
  id: string;
  name: string;
  description: string;
  tools: SkillTool[];
}

interface GeneratedWorkflow {
  name: string;
  description: string;
  steps: WorkflowStep[];
  yaml: string;
  suggestedTools: string[];
  goals: string;
  personality: string;
  scratchpad: string;
  role: string;
  schedule?: string;
  installSkills?: string[];
  createSkills?: CreateSkill[];
}

// ============================================
// Schedule Picker Component
// ============================================

const SCHEDULE_OPTIONS = [
  { label: 'Manual only', value: '', description: 'Run when you click the button' },
  { label: 'Every 5 minutes', value: '*/5 * * * *', description: 'Good for testing' },
  { label: 'Every 15 minutes', value: '*/15 * * * *', description: 'Frequent monitoring' },
  { label: 'Every 30 minutes', value: '*/30 * * * *', description: 'Regular checks' },
  { label: 'Every hour', value: '0 * * * *', description: 'Hourly updates' },
  { label: 'Every 2 hours', value: '0 */2 * * *', description: 'Bi-hourly tasks' },
  { label: 'Every 6 hours', value: '0 */6 * * *', description: '4 times daily' },
  { label: 'Every 12 hours', value: '0 */12 * * *', description: 'Twice daily' },
  { label: 'Daily at 9am', value: '0 9 * * *', description: 'Morning routine' },
  { label: 'Daily at 6pm', value: '0 18 * * *', description: 'Evening digest' },
  { label: 'Weekdays at 9am', value: '0 9 * * 1-5', description: 'Monday-Friday' },
  { label: 'Weekdays at 6pm', value: '0 18 * * 1-5', description: 'End of workday' },
  { label: 'Weekly (Mondays)', value: '0 9 * * 1', description: 'Weekly planning' },
  { label: 'Weekly (Fridays)', value: '0 17 * * 5', description: 'Weekly wrap-up' },
  { label: 'Monthly (1st)', value: '0 9 1 * *', description: 'Monthly report' },
];

export function SchedulePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [customMode, setCustomMode] = useState(false);

  // Check if current value matches a preset
  const matchingPreset = SCHEDULE_OPTIONS.find(opt => opt.value === value);
  const isCustom = value && !matchingPreset;

  return (
    <div className="space-y-3">
      {/* Preset Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {SCHEDULE_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => {
              onChange(option.value);
              setCustomMode(false);
            }}
            className={cn(
              "p-3 rounded-lg border text-left transition-all",
              value === option.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:border-primary/50 hover:bg-muted/50"
            )}
          >
            <div className="font-medium text-sm">{option.label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{option.description}</div>
          </button>
        ))}
      </div>

      {/* Custom Input Toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCustomMode(!customMode)}
          className="text-sm text-primary hover:underline"
        >
          {customMode ? 'Hide custom cron' : 'Use custom cron expression'}
        </button>
        {(isCustom || customMode) && (
          <span className="text-xs text-muted-foreground">
            Current: <code className="bg-muted px-1.5 py-0.5 rounded">{value || '—'}</code>
          </span>
        )}
      </div>

      {/* Custom Input */}
      {(isCustom || customMode) && (
        <div className="space-y-2">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g., 0 9 * * 1-5"
            className="bg-muted/50 font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Cron format: minute hour day month weekday.{' '}
            <a
              href="https://crontab.guru/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Need help?
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function AgentEditor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Input state
  const [description, setDescription] = useState('');
  const [agentName, setAgentName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Generated workflow state
  const [generatedWorkflow, setGeneratedWorkflow] = useState<GeneratedWorkflow | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  
  // Configuration state
  const [enableImmediately, setEnableImmediately] = useState(true);
  const [customSchedule, setCustomSchedule] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // YAML editor state
  const [showYamlEditor, setShowYamlEditor] = useState(false);
  const [editedYaml, setEditedYaml] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  
  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!generatedWorkflow) {
        throw new Error('No workflow generated');
      }
      
      // Validate all steps before creating
      const validationErrors: string[] = [];
      for (const [index, step] of generatedWorkflow.steps.entries()) {
        if (!step.name || step.name.trim().length < 2) {
          validationErrors.push(`Step ${index + 1}: Name must be at least 2 characters`);
        }
        if (!step.type) {
          validationErrors.push(`Step ${index + 1}: Type is required`);
        }
        if (step.type === 'llm' && (!step.prompt || step.prompt.trim().length < 10)) {
          validationErrors.push(`Step ${index + 1} (${step.name}): LLM step must have a prompt (min 10 chars)`);
        }
        if (step.type === 'skill' && !step.skill) {
          validationErrors.push(`Step ${index + 1} (${step.name}): Skill step must specify a skill ID`);
        }
        if (step.type === 'shell' && (!step.command || step.command.trim().length === 0)) {
          validationErrors.push(`Step ${index + 1} (${step.name}): Shell step must have a command`);
        }
      }
      
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed:\n${validationErrors.join('\n')}`);
      }
      
      const name = agentName.trim() || generatedWorkflow.name;
      
      // Install skills from registry if needed
      if (generatedWorkflow.installSkills && generatedWorkflow.installSkills.length > 0) {
        for (const skillId of generatedWorkflow.installSkills) {
          try {
            await fetch(`/api/skills/install`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ skillId }),
            });
          } catch (err) {
            console.error(`Failed to install skill ${skillId}:`, err);
          }
        }
      }
      
      // Create custom skills if needed
      if (generatedWorkflow.createSkills && generatedWorkflow.createSkills.length > 0) {
        for (const skill of generatedWorkflow.createSkills) {
          try {
            await fetch(`/api/skills/create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(skill),
            });
          } catch (err) {
            console.error(`Failed to create skill ${skill.id}:`, err);
          }
        }
      }
      
      // Create the agent with the generated workflow
      const agent = await agentsApi.create({
        name,
        description: generatedWorkflow.description,
        prompt: description,
        schedule: customSchedule || generatedWorkflow.schedule,
      });
      
      // Save agent memory/config
      await agentsApi.update(agent.id, {
        config: {
          personality: generatedWorkflow.personality,
          goals: generatedWorkflow.goals,
          scratchpad: generatedWorkflow.scratchpad,
          role: generatedWorkflow.role,
          suggestedTools: generatedWorkflow.suggestedTools,
          installSkills: generatedWorkflow.installSkills,
          createSkills: generatedWorkflow.createSkills,
        },
      });
      
      // Update the workflow with proper YAML
      await agentsApi.updateWorkflow(agent.id, generatedWorkflow.yaml);
      
      // Enable if requested
      if (enableImmediately) {
        await agentsApi.update(agent.id, { enabled: true });
      }
      
      return agent;
    },
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: agentsQueries.all() });
      toast.success('Agent created successfully!');
      navigate(`/agents/${agent.id}`);
    },
    onError: (err) => {
      toast.error('Failed to create agent', err instanceof Error ? err.message : 'Unknown error');
    },
  });

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(200, textarea.scrollHeight)}px`;
    }
  }, [description]);

  // Generate workflow using AI
  const handleGenerate = async () => {
    if (!description.trim()) {
      toast.error('Please describe what you want the agent to do');
      return;
    }
    
    setIsGenerating(true);
    
    try {
      // Call the AI generation endpoint
      const response = await fetch('/api/agents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate workflow');
      }
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      // Map API response fields (action → tool, params → parameters)
      const mappedSteps = result.steps?.map((s: any, i: number) => ({
        id: `step-${i}`,
        type: s.type || 'llm',
        name: s.name || `Step ${i + 1}`,
        skill: s.skill,
        tool: s.action || s.tool,  // Map action to tool
        prompt: s.prompt,
        command: s.command,
        parameters: s.params || s.parameters,  // Map params to parameters
        message: s.message,
        channel: s.channel,
      })) || [];
      
      setGeneratedWorkflow({
        name: result.name,
        description: result.description,
        steps: mappedSteps,
        yaml: result.yaml,
        suggestedTools: result.suggestedTools || [],
        goals: result.goals,
        personality: result.personality,
        scratchpad: result.scratchpad || '',
        role: result.role,
        schedule: result.schedule,
      });
      
      setAgentName(result.name);
      setShowPreview(true);
      toast.success('Workflow generated!');
    } catch (err) {
      toast.error('Failed to generate workflow', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (generatedWorkflow) {
        createMutation.mutate();
      } else {
        handleGenerate();
      }
    }
  };

  // Template prompts for quick start
  const templatePrompts = [
    {
      icon: <Bot className="w-4 h-4" />,
      label: "Research Agent",
      prompt: "Research the latest trends in AI agents. Search for recent articles, visit 3-5 relevant pages, and create a summary report with key findings. Run weekly on Mondays.",
    },
    {
      icon: <Target className="w-4 h-4" />,
      label: "Content Creator",
      prompt: "Check my email for content requests from the marketing team. Draft 3 social media posts and create a blog outline for each request. Post to Twitter and LinkedIn.",
    },
    {
      icon: <Brain className="w-4 h-4" />,
      label: "Monitor & Alert",
      prompt: "Monitor competitor pricing pages every week. Compare prices to our product and send me an email alert if any significant changes are detected.",
    },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b bg-card px-4 sm:px-6 py-4">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => navigate('/agents')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-semibold">Create Agent with AI</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Describe what you want and AI will build the workflow
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-3xl mx-auto">
          
          {/* Quick Templates */}
          {!generatedWorkflow && (
            <div className="mb-6">
              <p className="text-sm text-muted-foreground mb-3">Quick start templates:</p>
              <div className="flex flex-wrap gap-2">
                {templatePrompts.map((template) => (
                  <button
                    key={template.label}
                    onClick={() => setDescription(template.prompt)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted hover:bg-accent text-sm transition-colors"
                  >
                    {template.icon}
                    {template.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Main Input Area */}
          <div className={cn(
            "relative rounded-xl border-2 transition-all",
            generatedWorkflow 
              ? "border-primary bg-primary/5" 
              : "border-border bg-card focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
          )}>
            <Textarea
              ref={textareaRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want this agent to do...\n\nExample: Check my email every morning for PR requests and draft professional responses. Post approved content to Twitter and LinkedIn."
              className="min-h-[200px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-base"
              disabled={isGenerating || createMutation.isPending}
            />
            
            {/* Action Buttons */}
            <div className="flex items-center justify-between p-4 border-t">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Cmd+Enter to {generatedWorkflow ? 'create' : 'generate'}</span>
              </div>
              
              <div className="flex items-center gap-2">
                {generatedWorkflow ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setGeneratedWorkflow(null);
                        setShowPreview(false);
                      }}
                      disabled={createMutation.isPending}
                    >
                      Edit
                    </Button>
                    <Button
                      onClick={() => createMutation.mutate()}
                      disabled={createMutation.isPending || !agentName.trim()}
                      className="gap-2"
                    >
                      {createMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      Create Agent
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={handleGenerate}
                    disabled={isGenerating || !description.trim()}
                    className="gap-2"
                  >
                    {isGenerating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    Generate Workflow
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Tips */}
          {!generatedWorkflow && (
            <div className="mt-6 p-4 bg-muted/50 rounded-lg">
              <h4 className="text-sm font-medium mb-2">Tips for great results:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Be specific about triggers ("when email arrives", "every Monday at 9am")</li>
                <li>• Mention specific platforms or tools ("post to Twitter", "check GitHub")</li>
                <li>• Describe the output you want ("send me a summary", "create a report")</li>
                <li>• Include any data sources the agent should reference</li>
              </ul>
            </div>
          )}

          {/* Generated Preview */}
          {generatedWorkflow && (
            <div className="mt-6 space-y-4">
              {/* Success Banner */}
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="font-medium text-green-900">Workflow Generated!</h4>
                    <p className="text-sm text-green-700 mt-1">
                      AI analyzed your request and created a workflow with {generatedWorkflow.steps.length} steps.
                      Review below and click "Create Agent" to activate.
                    </p>
                  </div>
                </div>
              </div>

              {/* Agent Name */}
              <div className="p-4 bg-card border rounded-lg">
                <label className="block text-sm font-medium mb-2">
                  Agent Name
                </label>
                <Input
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="Name your agent..."
                  className="max-w-md"
                />
              </div>

              {/* Workflow Preview / YAML Editor */}
              <div className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="w-full flex items-center justify-between p-4 bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Wand2 className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">Workflow Preview</span>
                    <span className="text-sm text-muted-foreground">
                      ({generatedWorkflow.steps.length} steps)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {showPreview && (
                      <span className="text-xs text-muted-foreground">
                        {showYamlEditor ? 'Editing YAML' : 'Visual Preview'}
                      </span>
                    )}
                    {showPreview ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </button>
                
                {showPreview && (
                  <div className="p-4 space-y-3">
                    {/* Toggle between preview and YAML editor */}
                    <div className="flex items-center gap-2 mb-4">
                      <Button
                        variant={!showYamlEditor ? "default" : "outline"}
                        size="sm"
                        onClick={() => setShowYamlEditor(false)}
                      >
                        Visual Preview
                      </Button>
                      <Button
                        variant={showYamlEditor ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setShowYamlEditor(true);
                          setEditedYaml(generatedWorkflow.yaml);
                          setYamlError(null);
                        }}
                      >
                        <FileCode className="w-4 h-4 mr-2" />
                        Edit YAML
                      </Button>
                    </div>

                    {showYamlEditor ? (
                      /* YAML Editor */
                      <div className="space-y-3">
                        <Textarea
                          value={editedYaml}
                          onChange={(e) => {
                            setEditedYaml(e.target.value);
                            setYamlError(null);
                          }}
                          placeholder="Enter workflow YAML..."
                          className="min-h-[400px] font-mono text-sm bg-muted/50"
                        />
                        {yamlError && (
                          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                            <div className="text-sm text-red-700">
                              <strong>YAML Error:</strong> {yamlError}
                            </div>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            Edit the YAML directly. Make sure to keep the steps array valid.
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              try {
                                const parsed = YAML.load(editedYaml) as Record<string, unknown>;
                                if (!parsed || typeof parsed !== 'object') {
                                  throw new Error('YAML must be a valid object');
                                }
                                if (!Array.isArray(parsed.steps)) {
                                  throw new Error('YAML must have a "steps" array');
                                }
                                // Map YAML fields to WorkflowStep format (action → tool, params → parameters)
                                const mappedSteps = (parsed.steps as any[]).map((s: any, i: number) => ({
                                  id: `step-${i}`,
                                  type: s.type || 'llm',
                                  name: s.name || `Step ${i + 1}`,
                                  skill: s.skill,
                                  tool: s.action || s.tool,  // Map action to tool
                                  prompt: s.prompt,
                                  command: s.command,
                                  parameters: s.params || s.parameters,  // Map params to parameters
                                  message: s.message,
                                  channel: s.channel,
                                })) as WorkflowStep[];
                                // Update the workflow with validated YAML
                                setGeneratedWorkflow({
                                  ...generatedWorkflow,
                                  yaml: editedYaml,
                                  steps: mappedSteps,
                                });
                                setYamlError(null);
                                toast.success('YAML updated successfully');
                              } catch (err: any) {
                                setYamlError(err.message || 'Invalid YAML');
                              }
                            }}
                          >
                            Apply Changes
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* Editable Workflow Steps */
                      <WorkflowStepEditor
                        steps={generatedWorkflow.steps}
                        onChange={(newSteps) => {
                          // Rebuild YAML from updated steps
                          const yamlSteps = newSteps.map((step) => {
                            const base = `  - name: ${step.name}\n    type: ${step.type}`;
                            if (step.type === 'llm' && step.prompt) {
                              return `${base}\n    prompt: |\n${step.prompt.split('\n').map((l) => `      ${l}`).join('\n')}`;
                            }
                            if (step.type === 'skill' && step.skill) {
                              let skillStep = `${base}\n    skill: ${step.skill}\n    tool: ${step.tool || 'default'}`;
                              if (step.parameters && Object.keys(step.parameters).length > 0) {
                                const paramsYaml = Object.entries(step.parameters)
                                  .map(([k, v]) => `      ${k}: ${typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : v}`)
                                  .join('\n');
                                skillStep += `\n    parameters:\n${paramsYaml}`;
                              }
                              return skillStep;
                            }
                            if (step.type === 'shell' && step.command) {
                              return `${base}\n    command: ${step.command}`;
                            }
                            if (step.type === 'notify' && step.message) {
                              return `${base}\n    message: "${step.message.replace(/"/g, '\\"')}"${step.channel ? `\n    channel: "${step.channel}"` : ''}`;
                            }
                            return base;
                          }).join('\n');

                          const yaml = [
                            `name: "${generatedWorkflow.name}"`,
                            `description: "${generatedWorkflow.description}"`,
                            generatedWorkflow.schedule ? `schedule: "${generatedWorkflow.schedule}"` : '',
                            `steps:`,
                            yamlSteps,
                          ].filter(Boolean).join('\n') + '\n';

                          setGeneratedWorkflow({
                            ...generatedWorkflow,
                            steps: newSteps,
                            yaml,
                          });
                          setEditedYaml(yaml);
                        }}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* AI-Generated Memory/Knowledge */}
              <div className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between p-4 bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">Agent Memory & Goals</span>
                    <span className="text-xs text-muted-foreground">(AI-generated)</span>
                  </div>
                  {showAdvanced ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                
                {showAdvanced && (
                  <div className="p-4 space-y-4">
                    {/* Role */}
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium mb-2">
                        <UserCircle className="w-4 h-4 text-muted-foreground" />
                        Role
                      </label>
                      <Input
                        value={generatedWorkflow.role}
                        onChange={(e) => setGeneratedWorkflow({ ...generatedWorkflow, role: e.target.value })}
                        className="bg-muted/50"
                      />
                    </div>

                    {/* Goals */}
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium mb-2">
                        <Target className="w-4 h-4 text-muted-foreground" />
                        Goals
                      </label>
                      <Textarea
                        value={generatedWorkflow.goals}
                        onChange={(e) => setGeneratedWorkflow({ ...generatedWorkflow, goals: e.target.value })}
                        className="min-h-[100px] resize-none bg-muted/50"
                      />
                    </div>

                    {/* Personality */}
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium mb-2">
                        <Brain className="w-4 h-4 text-muted-foreground" />
                        Personality
                      </label>
                      <Textarea
                        value={generatedWorkflow.personality}
                        onChange={(e) => setGeneratedWorkflow({ ...generatedWorkflow, personality: e.target.value })}
                        className="min-h-[80px] resize-none bg-muted/50"
                      />
                    </div>

                    {/* Scratchpad */}
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium mb-2">
                        <StickyNote className="w-4 h-4 text-muted-foreground" />
                        Knowledge Base (Scratchpad)
                      </label>
                      <Textarea
                        value={generatedWorkflow.scratchpad}
                        onChange={(e) => setGeneratedWorkflow({ ...generatedWorkflow, scratchpad: e.target.value })}
                        className="min-h-[100px] resize-none bg-muted/50"
                        placeholder="Reference data, context, or initial knowledge for the agent..."
                      />
                    </div>

                    {/* Suggested Tools */}
                    {generatedWorkflow.suggestedTools.length > 0 && (
                      <div>
                        <label className="flex items-center gap-2 text-sm font-medium mb-2">
                          <Wand2 className="w-4 h-4 text-muted-foreground" />
                          Detected Tools & Skills
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {generatedWorkflow.suggestedTools.map((tool) => (
                            <span
                              key={tool}
                              className="inline-flex items-center px-2 py-1 rounded-md bg-primary/10 text-primary text-xs"
                            >
                              {tool}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Skills to Install */}
                    {generatedWorkflow.installSkills && generatedWorkflow.installSkills.length > 0 && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <label className="flex items-center gap-2 text-sm font-medium mb-2 text-blue-900">
                          <Download className="w-4 h-4" />
                          Skills to Install
                        </label>
                        <p className="text-xs text-blue-700 mb-2">
                          These skills will be automatically installed from the registry:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {generatedWorkflow.installSkills.map((skill) => (
                            <span
                              key={skill}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-100 text-blue-800 text-xs"
                            >
                              <Download className="w-3 h-3" />
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Custom Skills to Create */}
                    {generatedWorkflow.createSkills && generatedWorkflow.createSkills.length > 0 && (
                      <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                        <label className="flex items-center gap-2 text-sm font-medium mb-2 text-purple-900">
                          <Plus className="w-4 h-4" />
                          New Custom Skills to Create
                        </label>
                        <p className="text-xs text-purple-700 mb-2">
                          These custom skills will be created for this agent:
                        </p>
                        <div className="space-y-2">
                          {generatedWorkflow.createSkills.map((skill) => (
                            <div key={skill.id} className="p-2 bg-white rounded border border-purple-200">
                              <div className="font-medium text-sm text-purple-900">{skill.name}</div>
                              <div className="text-xs text-purple-700">{skill.description}</div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {skill.tools.map((tool) => (
                                  <span key={tool.name} className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded">
                                    {tool.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Schedule */}
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium mb-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        Schedule (Optional)
                      </label>
                      <SchedulePicker
                        value={customSchedule || generatedWorkflow.schedule || ''}
                        onChange={setCustomSchedule}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Enable Toggle */}
              <div className="flex items-center justify-between p-4 bg-card border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <Play className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-medium">Enable immediately</div>
                    <div className="text-sm text-muted-foreground">
                      Start running on schedule right away
                    </div>
                  </div>
                </div>
                <Switch
                  checked={enableImmediately}
                  onCheckedChange={setEnableImmediately}
                />
              </div>

              {/* Create Button */}
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setGeneratedWorkflow(null);
                    setShowPreview(false);
                  }}
                  disabled={createMutation.isPending}
                >
                  Back
                </Button>
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending || !agentName.trim()}
                  size="lg"
                  className="gap-2"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Create Agent
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
