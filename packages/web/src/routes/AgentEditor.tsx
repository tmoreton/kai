import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Sparkles, 
  Wand2,
  CheckCircle2,
  Bot,
  FileCode2,
  Bell,
  Search,
  Mail,
  TrendingUp,
  Calendar,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Clock,
  Play,
  ChevronDown,
  ChevronUp,
  Brain,
  Target,
  StickyNote,
  UserCircle,
} from "lucide-react";
import { agentsApi } from '../api/client';
import { agentsQueries } from '../api/queries';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { toast } from '../components/Toast';
import { cn } from '../lib/utils';
import type { WorkflowStep } from '../components/WorkflowEditor';

// ============================================
// Agent Templates
// ============================================

interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: 'marketing' | 'sales' | 'research' | 'operations';
  suggestedTools: string[];
  examplePrompt: string;
  defaultSchedule?: string;
  defaultGoals?: string;
  defaultPersonality?: string;
  defaultScratchpad?: string;
}

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'social-media',
    name: 'Social Media Manager',
    description: 'Monitors email for content requests and drafts social posts',
    icon: <Bot className="w-6 h-6" />,
    category: 'marketing',
    suggestedTools: ['email', 'web-search', 'x-api'],
    examplePrompt: 'Check my email for content requests from the marketing team. Draft 3 Twitter posts and 1 LinkedIn post for each request. Research current trends if needed.',
    defaultSchedule: '0 9 * * 1-5',
    defaultGoals: '• Increase engagement on social media channels\n• Maintain consistent brand voice\n• Respond to content requests within 24 hours',
    defaultPersonality: 'Professional but friendly social media expert. Upbeat tone, uses relevant hashtags, stays current with trends.',
  },
  {
    id: 'email-marketing',
    name: 'Email Campaign Assistant',
    description: 'Creates email campaigns and newsletter content',
    icon: <Mail className="w-6 h-6" />,
    category: 'marketing',
    suggestedTools: ['email', 'web-search'],
    examplePrompt: 'Create a weekly newsletter with industry news, product updates, and a featured article. Reference our brand voice and goals in your writing.',
    defaultGoals: '• Create engaging weekly newsletters\n• Maintain consistent brand voice\n• Drive email engagement and click-through rates',
    defaultPersonality: 'Professional email marketer with excellent copywriting skills. Clear, concise, and compelling.',
  },
  {
    id: 'competitor-monitor',
    name: 'Competitor Monitor',
    description: 'Tracks competitor pricing and product changes',
    icon: <TrendingUp className="w-6 h-6" />,
    category: 'sales',
    suggestedTools: ['browser', 'notify'],
    examplePrompt: 'Visit competitor1.com/pricing and competitor2.com/pricing weekly. Compare to our current pricing. If changes detected, notify me and log the comparison.',
    defaultSchedule: '0 8 * * 1',
    defaultGoals: '• Monitor competitor pricing weekly\n• Alert on significant price changes\n• Maintain competitive pricing intelligence',
    defaultPersonality: 'Analytical and detail-oriented. Focuses on accurate data collection and clear reporting.',
    defaultScratchpad: 'Our pricing:\n• Basic: $29/mo\n• Pro: $99/mo\n• Enterprise: Contact us',
  },
  {
    id: 'research-assistant',
    name: 'Research Assistant',
    description: 'Researches topics and summarizes findings',
    icon: <Search className="w-6 h-6" />,
    category: 'research',
    suggestedTools: ['web-search', 'web-fetch'],
    examplePrompt: 'Research the latest trends in AI agents. Search for recent articles, visit 3-5 relevant pages, and create a summary report. Log key findings for future reference.',
    defaultGoals: '• Conduct thorough research on assigned topics\n• Provide comprehensive summaries\n• Build a knowledge base in scratchpad',
    defaultPersonality: 'Thorough researcher who digs deep into topics. Provides well-sourced, comprehensive summaries.',
  },
  {
    id: 'content-calendar',
    name: 'Content Calendar',
    description: 'Plans and schedules content across channels',
    icon: <Calendar className="w-6 h-6" />,
    category: 'marketing',
    suggestedTools: ['web-search'],
    examplePrompt: 'Create a 2-week content calendar with blog topics, social posts, and email campaigns based on our strategy and target audience.',
    defaultGoals: '• Plan consistent content across all channels\n• Align content with business goals\n• Maintain editorial calendar',
    defaultPersonality: 'Strategic content planner. Organized, creative, and always thinking several steps ahead.',
    defaultScratchpad: 'Content Strategy:\n• Content pillars: AI tutorials, product updates, industry news\n• Target audience: Developers and indie hackers\n• Posting schedule: 3x/week blog, daily social',
  },
  {
    id: 'alert-monitor',
    name: 'Alert & Monitor',
    description: 'Watches websites and sends notifications',
    icon: <Bell className="w-6 h-6" />,
    category: 'operations',
    suggestedTools: ['browser', 'email'],
    examplePrompt: 'Check example.com/status every hour. If the status is not "operational", send me an email alert immediately. Maintain a status log.',
    defaultSchedule: '0 * * * *',
    defaultGoals: '• Monitor critical systems 24/7\n• Alert immediately on issues\n• Maintain uptime logs',
    defaultPersonality: 'Vigilant and reliable. Never misses a check, alerts promptly, keeps detailed records.',
  },
  {
    id: 'code-reviewer',
    name: 'Code Review Assistant',
    description: 'Reviews code for issues and best practices',
    icon: <FileCode2 className="w-6 h-6" />,
    category: 'operations',
    suggestedTools: ['file-read'],
    examplePrompt: 'When new commits are pushed, review the changed files for code quality issues, security concerns, and style violations.',
    defaultGoals: '• Maintain code quality standards\n• Catch security issues early\n• Enforce consistent style',
    defaultPersonality: 'Experienced code reviewer. Detail-oriented, constructive feedback, security-focused.',
    defaultScratchpad: 'Coding Standards:\n• Use TypeScript for all new code\n• Maximum function length: 50 lines\n• Always include error handling\n• Write tests for new features',
  },
  {
    id: 'custom',
    name: 'Custom Agent',
    description: 'Describe what you want and AI will build it',
    icon: <Sparkles className="w-6 h-6" />,
    category: 'operations',
    suggestedTools: [],
    examplePrompt: '',
  },
];

// ============================================
// Types
// ============================================

type CreationStep = 'template' | 'describe' | 'review' | 'configure';

interface GeneratedWorkflow {
  name: string;
  description: string;
  steps: WorkflowStep[];
  yaml: string;
}

// ============================================
// Main Component
// ============================================

export function AgentEditor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // Step state
  const [currentStep, setCurrentStep] = useState<CreationStep>('template');
  
  // Selection state
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);
  const [description, setDescription] = useState('');
  
  // Generated workflow state
  const [generatedWorkflow, setGeneratedWorkflow] = useState<GeneratedWorkflow | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Configuration state
  const [agentName, setAgentName] = useState('');
  const [schedule, setSchedule] = useState('');
  const [enableImmediately, setEnableImmediately] = useState(true);
  
  // Agent memory/knowledge state (now set in Describe step)
  const [agentGoals, setAgentGoals] = useState('');
  const [agentScratchpad, setAgentScratchpad] = useState('');
  const [agentPersonality, setAgentPersonality] = useState('');
  const [agentRole, setAgentRole] = useState('');
  
  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!generatedWorkflow || !agentName.trim()) {
        throw new Error('Missing required fields');
      }
      
      // Create the agent first
      const agent = await agentsApi.create({
        name: agentName,
        description: generatedWorkflow.description,
        prompt: description,
      });
      
      // Save agent memory directly to agent config (matches AgentDetail expectations)
      if (agentGoals || agentPersonality || agentRole || agentScratchpad) {
        try {
          await agentsApi.update(agent.id, {
            config: {
              personality: agentPersonality || selectedTemplate?.defaultPersonality || '',
              goals: agentGoals || selectedTemplate?.defaultGoals || '',
              scratchpad: agentScratchpad || selectedTemplate?.defaultScratchpad || '',
              role: agentRole || selectedTemplate?.name || 'AI Assistant',
            },
          });
        } catch (err) {
          console.error('Failed to save agent memory:', err);
          // Don't fail the whole creation if memory save fails
        }
      }
      
      // Update the workflow
      await agentsApi.updateWorkflow(agent.id, generatedWorkflow.yaml);
      
      // Enable if requested
      if (enableImmediately) {
        await agentsApi.update(agent.id, { 
          enabled: true,
          schedule: schedule || undefined,
        });
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

  // Handle template selection
  const handleSelectTemplate = (template: AgentTemplate) => {
    setSelectedTemplate(template);
    setAgentName(template.name);
    setAgentRole(template.name);
    if (template.defaultSchedule) {
      setSchedule(template.defaultSchedule);
    }
    if (template.defaultGoals) {
      setAgentGoals(template.defaultGoals);
    }
    if (template.defaultPersonality) {
      setAgentPersonality(template.defaultPersonality);
    }
    if (template.defaultScratchpad) {
      setAgentScratchpad(template.defaultScratchpad);
    }
    
    if (template.id === 'custom') {
      setDescription('');
      setAgentGoals('');
      setAgentPersonality('');
      setAgentScratchpad('');
    } else {
      setDescription(template.examplePrompt);
    }
    
    setCurrentStep('describe');
  };

  // Handle workflow generation
  const handleGenerate = async () => {
    if (!description.trim() || !selectedTemplate) return;
    
    setIsGenerating(true);
    
    try {
      const systemPrompt = `You are a workflow designer for an AI agent system called Kai.

Create a YAML workflow based on the user's description. The workflow should:
1. Have a clear name and description matching what the user wants
2. Use appropriate step types: llm (AI calls), skill (tool calls), shell (commands), notify (alerts)
3. Chain outputs using {{step_name.output}} or {{step_name.result}} syntax
4. Be practical and accomplish the user's goal

Available skills: email, data, browser, web-search, x-api, web-tools

Built-in tools (always available):
- agent_memory_read — Read agent's goals, scratchpad, and stored knowledge
- agent_memory_update — Update agent's goals or scratchpad

IMPORTANT: The agent stores its knowledge in goals and scratchpad fields. Use agent_memory_read to access this stored knowledge.

Return ONLY valid YAML content, no markdown formatting or explanation. The YAML should have this structure:
name: "Agent Name"
description: "What this agent does"
steps:
  - name: step_name
    type: llm|skill|shell|notify
    ...step specific fields`;

      const response = await fetch('/api/generate-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          userPrompt: `Create a workflow for: ${description}\n\nAgent name: ${agentName || selectedTemplate.name}\nCategory: ${selectedTemplate.category}\n\nRole: ${agentRole}\n\nGoals:\n${agentGoals}\n\nPersonality:\n${agentPersonality}\n\nKnowledge/Scratchpad:\n${agentScratchpad}`,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate workflow');
      }

      const { yaml } = await response.json();
      
      // Parse YAML to get workflow object
      const { parse } = await import('yaml');
      const parsed = parse(yaml);
      
      setGeneratedWorkflow({
        name: parsed.name || agentName,
        description: parsed.description || description.substring(0, 100),
        steps: parsed.steps || [],
        yaml,
      });
      
      setCurrentStep('review');
    } catch (err) {
      toast.error('Failed to generate workflow', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle back navigation
  const handleBack = () => {
    if (currentStep === 'configure') {
      setCurrentStep('review');
    } else if (currentStep === 'review') {
      setCurrentStep('describe');
    } else if (currentStep === 'describe') {
      setCurrentStep('template');
      setSelectedTemplate(null);
    } else {
      navigate('/agents');
    }
  };

  // Handle final creation
  const handleCreate = () => {
    createMutation.mutate();
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="flex items-center gap-4 px-4 py-3">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-accent rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          
          <div className="flex-1">
            <h1 className="text-lg font-semibold">
              {currentStep === 'template' && 'Choose a Template'}
              {currentStep === 'describe' && 'Describe Your Agent'}
              {currentStep === 'review' && 'Review Workflow'}
              {currentStep === 'configure' && 'Configure Agent'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {currentStep === 'template' && 'Select a starting point or build custom'}
              {currentStep === 'describe' && 'Describe tasks, set goals, and define knowledge'}
              {currentStep === 'review' && 'AI generated this workflow based on your description'}
              {currentStep === 'configure' && 'Final settings before creating'}
            </p>
          </div>
          
          {/* Progress indicators */}
          <div className="hidden sm:flex items-center gap-2">
            {(['template', 'describe', 'review', 'configure'] as CreationStep[]).map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                  currentStep === step && "bg-primary text-primary-foreground",
                  ['template', 'describe', 'review', 'configure'].indexOf(currentStep) > i && "bg-green-500 text-white",
                  currentStep !== step && ['template', 'describe', 'review', 'configure'].indexOf(currentStep) < i && "bg-muted text-muted-foreground"
                )}>
                  {['template', 'describe', 'review', 'configure'].indexOf(currentStep) > i ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    i + 1
                  )}
                </div>
                {i < 3 && (
                  <div className={cn(
                    "w-8 h-0.5",
                    ['template', 'describe', 'review', 'configure'].indexOf(currentStep) > i ? "bg-green-500" : "bg-muted"
                  )} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {currentStep === 'template' && (
          <TemplateStep 
            templates={AGENT_TEMPLATES}
            onSelect={handleSelectTemplate}
          />
        )}
        
        {currentStep === 'describe' && selectedTemplate && (
          <DescribeStep
            template={selectedTemplate}
            agentName={agentName}
            onAgentNameChange={setAgentName}
            description={description}
            onDescriptionChange={setDescription}
            goals={agentGoals}
            onGoalsChange={setAgentGoals}
            personality={agentPersonality}
            onPersonalityChange={setAgentPersonality}
            scratchpad={agentScratchpad}
            onScratchpadChange={setAgentScratchpad}
            role={agentRole}
            onRoleChange={setAgentRole}
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
          />
        )}
        
        {currentStep === 'review' && generatedWorkflow && (
          <ReviewStep
            workflow={generatedWorkflow}
            onBack={() => setCurrentStep('describe')}
            onContinue={() => setCurrentStep('configure')}
            onEdit={() => setCurrentStep('describe')}
          />
        )}
        
        {currentStep === 'configure' && generatedWorkflow && (
          <ConfigureStep
            name={agentName}
            onNameChange={setAgentName}
            schedule={schedule}
            onScheduleChange={setSchedule}
            enableImmediately={enableImmediately}
            onEnableChange={setEnableImmediately}
            onCreate={handleCreate}
            isCreating={createMutation.isPending}
            workflow={generatedWorkflow}
          />
        )}
      </div>
    </div>
  );
}

// ============================================
// Template Selection Step
// ============================================

function TemplateStep({ 
  templates, 
  onSelect 
}: { 
  templates: AgentTemplate[]; 
  onSelect: (t: AgentTemplate) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  
  const categories = {
    marketing: 'Marketing',
    sales: 'Sales',
    research: 'Research',
    operations: 'Operations',
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-semibold mb-2">What would you like to automate?</h2>
          <p className="text-muted-foreground">Choose a template or describe your own custom agent</p>
        </div>

        {/* Template Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => onSelect(template)}
              onMouseEnter={() => setHoveredId(template.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={cn(
                "relative p-5 rounded-xl border-2 text-left transition-all duration-200",
                "hover:shadow-lg hover:-translate-y-1",
                template.id === 'custom'
                  ? "border-dashed border-primary/50 bg-primary/5 hover:border-primary hover:bg-primary/10"
                  : "border-border bg-card hover:border-primary/50 hover:bg-accent/50"
              )}
            >
              {/* Icon */}
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-colors",
                template.id === 'custom'
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
                hoveredId === template.id && template.id !== 'custom' && "bg-primary/10 text-primary"
              )}>
                {template.icon}
              </div>

              {/* Content */}
              <h3 className="font-semibold text-foreground mb-1">{template.name}</h3>
              <p className="text-sm text-muted-foreground line-clamp-2">{template.description}</p>

              {/* Category badge */}
              <div className="mt-3">
                <span className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                  template.category === 'marketing' && "bg-pink-100 text-pink-700",
                  template.category === 'sales' && "bg-blue-100 text-blue-700",
                  template.category === 'research' && "bg-purple-100 text-purple-700",
                  template.category === 'operations' && "bg-gray-100 text-gray-700"
                )}>
                  {categories[template.category]}
                </span>
              </div>

              {/* Hover hint */}
              {hoveredId === template.id && (
                <div className="absolute inset-0 flex items-center justify-center bg-card/95 rounded-xl">
                  <span className="flex items-center gap-2 text-primary font-medium">
                    Use Template <ArrowRight className="w-4 h-4" />
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Bottom hint */}
        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">
            Not sure what you need?{' '}
            <button 
              onClick={() => onSelect(AGENT_TEMPLATES.find(t => t.id === 'custom')!)}
              className="text-primary hover:underline"
            >
              Describe your goal and we'll suggest the best approach
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Describe Step - Now includes Goals & Knowledge
// ============================================

function DescribeStep({
  template,
  agentName,
  onAgentNameChange,
  description,
  onDescriptionChange,
  goals,
  onGoalsChange,
  personality,
  onPersonalityChange,
  scratchpad,
  onScratchpadChange,
  role,
  onRoleChange,
  onGenerate,
  isGenerating,
}: {
  template: AgentTemplate;
  agentName: string;
  onAgentNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  goals: string;
  onGoalsChange: (v: string) => void;
  personality: string;
  onPersonalityChange: (v: string) => void;
  scratchpad: string;
  onScratchpadChange: (v: string) => void;
  role: string;
  onRoleChange: (v: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'describe' | 'knowledge'>('describe');

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        {/* Template info */}
        <div className="flex items-center gap-3 p-4 bg-accent/50 rounded-xl mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            {template.icon}
          </div>
          <div>
            <h3 className="font-medium">{template.name}</h3>
            <p className="text-sm text-muted-foreground">{template.description}</p>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('describe')}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === 'describe'
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            )}
          >
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              What to Do
            </span>
          </button>
          <button
            onClick={() => setActiveTab('knowledge')}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === 'knowledge'
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            )}
          >
            <span className="flex items-center gap-2">
              <Brain className="w-4 h-4" />
              Goals & Knowledge
            </span>
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'describe' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Describe what you want this agent to do
              </label>
              <div className="relative">
                <Textarea
                  value={description}
                  onChange={(e) => onDescriptionChange(e.target.value)}
                  placeholder={template.id === 'custom' 
                    ? "E.g., Check my email every morning for PR requests and draft professional responses..."
                    : "Describe your specific needs (you can edit the example below)..."
                  }
                  className="min-h-[200px] resize-none"
                  disabled={isGenerating}
                />
                {isGenerating && (
                  <div className="absolute inset-0 bg-background/80 flex items-center justify-center rounded-lg">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>AI is designing your workflow...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Suggested tools */}
            {template.suggestedTools.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="w-4 h-4" />
                <span>This agent may use: {template.suggestedTools.join(', ')}</span>
              </div>
            )}

            {/* Tips */}
            <div className="p-4 bg-muted/50 rounded-lg">
              <h4 className="text-sm font-medium mb-2">Tips for great results:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Be specific about triggers ("when email arrives", "every Monday")</li>
                <li>• Mention specific tools ("search the web", "post to Twitter")</li>
                <li>• Use agent_memory to access goals and knowledge (set in the next tab)</li>
                <li>• Describe the output you want ("send me a summary")</li>
              </ul>
            </div>

            {/* Next tab hint */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-3">
                <Brain className="w-5 h-5 text-blue-600 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-medium text-blue-900 mb-1">Next: Define Goals & Knowledge</h4>
                  <p className="text-sm text-blue-700">
                    Click the "Goals & Knowledge" tab to set what this agent should know and achieve. 
                    The agent will use this information during execution via agent_memory tools.
                  </p>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setActiveTab('knowledge')}
                >
                  Go to Knowledge
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Agent Name */}
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                <Bot className="w-4 h-4 text-muted-foreground" />
                Agent Name
              </label>
              <Input
                value={agentName}
                onChange={(e) => onAgentNameChange(e.target.value)}
                placeholder="e.g., Social Media Bot, Research Assistant"
              />
              <p className="text-xs text-muted-foreground mt-1">
                What you'll call this agent (can be changed later)
              </p>
            </div>

            {/* Role */}
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                <UserCircle className="w-4 h-4 text-muted-foreground" />
                Role
              </label>
              <Input
                value={role}
                onChange={(e) => onRoleChange(e.target.value)}
                placeholder="e.g., Marketing Manager, Research Analyst, Support Agent"
              />
              <p className="text-xs text-muted-foreground mt-1">
                The agent's job title or primary function
              </p>
            </div>

            {/* Goals */}
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                <Target className="w-4 h-4 text-muted-foreground" />
                Goals
              </label>
              <Textarea
                value={goals}
                onChange={(e) => onGoalsChange(e.target.value)}
                placeholder={`e.g.,\n• Increase social media engagement by 20%\n• Respond to all customer emails within 2 hours\n• Monitor competitors weekly and report changes`}
                className="min-h-[120px] resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">
                What this agent is trying to achieve. These guide its decision-making. Use bullet points.
              </p>
            </div>

            {/* Personality */}
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-muted-foreground" />
                Personality & Voice
              </label>
              <Textarea
                value={personality}
                onChange={(e) => onPersonalityChange(e.target.value)}
                placeholder="e.g., Professional but friendly. Uses clear, concise language. Enthusiastic about helping users."
                className="min-h-[100px] resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">
                How the agent communicates. Affects tone in emails, social posts, etc.
              </p>
            </div>

            {/* Scratchpad - Working Notes */}
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-muted-foreground" />
                Knowledge Base / Scratchpad
              </label>
              <Textarea
                value={scratchpad}
                onChange={(e) => onScratchpadChange(e.target.value)}
                placeholder={`e.g.,\n• Brand colors: #0D9488 (teal), #115E59 (dark teal)\n• Competitor pricing: Basic $29/mo, Pro $99/mo\n• Content pillars: AI tutorials, product updates, industry news`}
                className="min-h-[150px] resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Key facts, reference data, and context the agent should remember. The agent can update this during execution. Use bullet points for easy reading.
              </p>
            </div>

            {/* Info box */}
            <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2 text-purple-900">
                <Brain className="w-4 h-4" />
                How This Works in Your Workflow
              </h4>
              <ul className="text-sm text-purple-700 space-y-1">
                <li>• Goals guide the agent's priorities and decisions</li>
                <li>• Personality affects how it writes and communicates</li>
                <li>• Scratchpad stores working notes and can be updated during workflows</li>
                <li>• The workflow will use <code>agent_memory_read</code> to access this information</li>
              </ul>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-3 pt-6 border-t mt-6">
          {activeTab === 'knowledge' && (
            <Button variant="outline" onClick={() => setActiveTab('describe')}>
              Back to Description
            </Button>
          )}
          <Button
            onClick={onGenerate}
            disabled={!description.trim() || isGenerating}
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4 mr-2" />
                Generate Workflow
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Review Step
// ============================================

function ReviewStep({
  workflow,
  onBack,
  onContinue,
  onEdit,
}: {
  workflow: GeneratedWorkflow;
  onBack: () => void;
  onContinue: () => void;
  onEdit: () => void;
}) {
  const [showYaml, setShowYaml] = useState(false);

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Success banner */}
          <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
            <div>
              <h3 className="font-medium text-green-900">Workflow Generated!</h3>
              <p className="text-sm text-green-700">
                AI created a {workflow.steps.length}-step workflow based on your description and goals
              </p>
            </div>
          </div>

          {/* Workflow name & description */}
          <div>
            <h2 className="text-xl font-semibold mb-1">{workflow.name}</h2>
            <p className="text-muted-foreground">{workflow.description}</p>
          </div>

          {/* Steps overview */}
          <div className="space-y-3">
            <h3 className="font-medium">Workflow Steps:</h3>
            {workflow.steps.map((step, i) => (
              <div 
                key={step.id || i} 
                className="flex items-start gap-4 p-4 bg-card border rounded-lg"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{step.name}</span>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full",
                      step.type === 'llm' && "bg-blue-100 text-blue-700",
                      step.type === 'skill' && "bg-purple-100 text-purple-700",
                      step.type === 'shell' && "bg-gray-100 text-gray-700",
                      step.type === 'notify' && "bg-yellow-100 text-yellow-700"
                    )}>
                      {step.type}
                    </span>
                  </div>
                  {step.prompt && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {step.prompt}
                    </p>
                  )}
                  {step.command && (
                    <code className="text-xs bg-muted px-2 py-1 rounded block mt-1">
                      {step.command}
                    </code>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* YAML toggle */}
          <div>
            <button
              onClick={() => setShowYaml(!showYaml)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              {showYaml ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showYaml ? 'Hide' : 'Show'} YAML Configuration
            </button>
            {showYaml && (
              <pre className="mt-2 p-4 bg-muted rounded-lg text-xs overflow-x-auto">
                {workflow.yaml}
              </pre>
            )}
          </div>

          {/* Edit note */}
          <p className="text-sm text-muted-foreground">
            You can edit this workflow anytime after creation from the agent details page.
          </p>
        </div>
      </div>

      {/* Footer actions */}
      <div className="border-t border-border p-4 bg-card">
        <div className="max-w-4xl mx-auto flex justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button variant="ghost" onClick={onEdit}>
              Edit Description
            </Button>
          </div>
          <Button onClick={onContinue} size="lg">
            Continue to Setup
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Configure Step
// ============================================

function ConfigureStep({
  name,
  onNameChange,
  schedule,
  onScheduleChange,
  enableImmediately,
  onEnableChange,
  onCreate,
  isCreating,
  workflow,
}: {
  name: string;
  onNameChange: (v: string) => void;
  schedule: string;
  onScheduleChange: (v: string) => void;
  enableImmediately: boolean;
  onEnableChange: (v: boolean) => void;
  onCreate: () => void;
  isCreating: boolean;
  workflow: GeneratedWorkflow;
}) {
  const scheduleOptions = [
    { value: '', label: 'Manual only (run on demand)' },
    { value: '0 9 * * 1-5', label: 'Weekdays at 9:00 AM' },
    { value: '0 9 * * *', label: 'Daily at 9:00 AM' },
    { value: '0 * * * *', label: 'Every hour' },
    { value: '0 0 * * 1', label: 'Weekly on Monday' },
    { value: 'custom', label: 'Custom cron expression...' },
  ];

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Summary card */}
        <div className="p-4 bg-accent/50 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium">{workflow.name}</p>
              <p className="text-sm text-muted-foreground">
                {workflow.steps.length} steps • {workflow.steps.filter(s => s.type === 'llm').length} AI calls
              </p>
            </div>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Agent Name
          </label>
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="My Awesome Agent"
          />
        </div>

        {/* Schedule */}
        <div>
          <label className="block text-sm font-medium mb-2">
            When should this agent run?
          </label>
          <div className="space-y-2">
            {scheduleOptions.map((option) => (
              <label 
                key={option.value} 
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  schedule === option.value 
                    ? "border-primary bg-primary/5" 
                    : "border-border hover:bg-accent/50"
                )}
              >
                <input
                  type="radio"
                  name="schedule"
                  value={option.value}
                  checked={schedule === option.value}
                  onChange={(e) => onScheduleChange(e.target.value)}
                  className="sr-only"
                />
                <Clock className="w-5 h-5 text-muted-foreground" />
                <span className="flex-1">{option.label}</span>
                {schedule === option.value && (
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                )}
              </label>
            ))}
          </div>
          
          {schedule === 'custom' && (
            <div className="mt-2">
              <Input
                value={schedule}
                onChange={(e) => onScheduleChange(e.target.value)}
                placeholder="0 9 * * 1-5"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Enter a cron expression (e.g., "0 9 * * 1-5" for weekdays at 9am)
              </p>
            </div>
          )}
        </div>

        {/* Enable toggle */}
        <label className="flex items-center gap-3 p-4 border rounded-lg cursor-pointer hover:bg-accent/50">
          <input
            type="checkbox"
            checked={enableImmediately}
            onChange={(e) => onEnableChange(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <div className="flex-1">
            <p className="font-medium">Enable immediately</p>
            <p className="text-sm text-muted-foreground">
              Start running according to schedule right away
            </p>
          </div>
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4">
          <Button
            onClick={onCreate}
            disabled={!name.trim() || isCreating}
            size="lg"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Create Agent
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
