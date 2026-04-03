import { useState, useRef, useEffect } from "react";
import { 
  Sparkles, 
  Send, 
  Wand2,
  CheckCircle2,
  AlertCircle,
  X,
  Bot,
  FileCode2,
} from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "./Toast";
import { WorkflowEditor } from "./WorkflowEditor";

interface AIWorkflowCreatorProps {
  agentName: string;
  agentDescription?: string;
  onWorkflowGenerated: (yaml: string, workflow: any) => void;
  onCancel?: () => void;
}

type CreatorState = 
  | { type: 'input' }
  | { type: 'generating'; prompt: string }
  | { type: 'review'; yaml: string; workflow: any }
  | { type: 'error'; message: string };

interface Suggestion {
  icon: React.ReactNode;
  title: string;
  prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: <Bot className="w-4 h-4" />,
    title: "Research Agent",
    prompt: "Create an agent that researches a topic by searching the web, extracting key information, and summarizing findings into a markdown report."
  },
  {
    icon: <FileCode2 className="w-4 h-4" />,
    title: "Content Creator",
    prompt: "Create an agent that generates blog post ideas, writes drafts, and saves them as markdown files."
  },
  {
    icon: <CheckCircle2 className="w-4 h-4" />,
    title: "Monitor & Alert",
    prompt: "Create an agent that monitors a website for changes and sends email notifications when updates are detected."
  },
];

export function AIWorkflowCreator({ 
  agentName, 
  agentDescription, 
  onWorkflowGenerated,
  onCancel 
}: AIWorkflowCreatorProps) {
  const [state, setState] = useState<CreatorState>({ type: 'input' });
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(100, textarea.scrollHeight)}px`;
    }
  }, [prompt]);

  const generateWorkflow = async (userPrompt: string) => {
    setState({ type: 'generating', prompt: userPrompt });

    try {
      const systemPrompt = `You are a workflow designer for an AI agent system. 

Create a YAML workflow based on the user's description. The workflow should:
1. Have a clear name and description
2. Use appropriate steps (llm, skill, shell, notify)
3. Chain outputs from one step to inputs of the next using {{step_name.output}} syntax
4. Be practical and accomplish the user's goal

Available skills: data (read/write files), youtube (video search), browser (web scraping), email (send emails), web-tools (HTTP requests)

Return ONLY the YAML content, no markdown formatting or explanation.`;

      const response = await fetch('/api/generate-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          userPrompt: `Agent name: ${agentName}\nDescription: ${agentDescription || 'No description'}\n\nGoal: ${userPrompt}`,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate workflow');
      }

      const { yaml } = await response.json();
      
      // Parse YAML to get workflow object
      const { parse } = await import('yaml');
      const workflow = parse(yaml);

      setState({ type: 'review', yaml, workflow });
    } catch (err) {
      setState({ 
        type: 'error', 
        message: err instanceof Error ? err.message : 'Failed to generate workflow' 
      });
      toast.error('Workflow generation failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    generateWorkflow(prompt.trim());
  };

  const handleSuggestion = (suggestion: Suggestion) => {
    setPrompt(suggestion.prompt);
    generateWorkflow(suggestion.prompt);
  };

  const handleApprove = () => {
    if (state.type === 'review') {
      onWorkflowGenerated(state.yaml, state.workflow);
    }
  };

  const handleRegenerate = () => {
    if (state.type === 'review') {
      generateWorkflow(state.workflow.description || prompt);
    }
  };

  // Input state
  if (state.type === 'input') {
    return (
      <div className="flex flex-col h-full max-w-2xl mx-auto">
        <div className="flex-1 flex flex-col justify-center">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Create Workflow with AI</h2>
            <p className="text-muted-foreground">
              Describe what you want {agentName} to do, and I'll create a workflow for you.
            </p>
          </div>

          {/* Suggestions */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {SUGGESTIONS.map((suggestion, i) => (
              <button
                key={i}
                onClick={() => handleSuggestion(suggestion)}
                className="p-4 border rounded-lg hover:border-primary hover:bg-primary/5 transition-colors text-left"
              >
                <div className="text-primary mb-2">{suggestion.icon}</div>
                <div className="font-medium text-sm">{suggestion.title}</div>
              </button>
            ))}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={`Describe what you want ${agentName} to do...\n\nExample: "Search for YouTube videos about TypeScript, summarize the top 3, and save the results to a markdown file"`}
                className="w-full min-h-[120px] p-4 pr-12 bg-background border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                type="submit"
                disabled={!prompt.trim()}
                size="sm"
                className="absolute bottom-3 right-3"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Press Enter to send, Shift+Enter for new line
            </p>
          </form>
        </div>

        {onCancel && (
          <div className="flex justify-center mt-6">
            <Button variant="ghost" onClick={onCancel}>
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Generating state
  if (state.type === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4 animate-pulse">
          <Wand2 className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Designing your workflow...</h3>
        <p className="text-muted-foreground max-w-md text-center">
          {state.prompt}
        </p>
        <Button variant="ghost" onClick={() => setState({ type: 'input' })} className="mt-6">
          Cancel
        </Button>
      </div>
    );
  }

  // Review state
  if (state.type === 'review') {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Review Workflow</h3>
            <p className="text-sm text-muted-foreground">
              Here's what I created. You can edit it or regenerate.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleRegenerate}>
              <Sparkles className="w-4 h-4 mr-2" />
              Regenerate
            </Button>
            <Button variant="outline" onClick={() => setState({ type: 'input' })}>
              Start Over
            </Button>
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-auto border rounded-lg bg-muted/30 mb-4">
          <WorkflowEditor
            initialWorkflow={{
              id: 'preview',
              name: state.workflow.name || agentName,
              description: state.workflow.description || '',
              version: state.workflow.version || '1.0.0',
              steps: state.workflow.steps?.map((s: any, i: number) => ({
                id: String(i),
                type: s.type || 'llm',
                name: s.name || `Step ${i + 1}`,
                skill: s.skill,
                tool: s.action,
                prompt: s.prompt,
                command: s.command,
                parameters: s.params,
              })) || [],
            }}
            onSave={async (_, yaml) => {
              onWorkflowGenerated(yaml, state.workflow);
            }}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setState({ type: 'input' })}>
            Back
          </Button>
          <Button onClick={handleApprove}>
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Use This Workflow
          </Button>
        </div>
      </div>
    );
  }

  // Error state
  if (state.type === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <AlertCircle className="w-16 h-16 text-destructive mb-4" />
        <h3 className="text-xl font-semibold mb-2">Something went wrong</h3>
        <p className="text-muted-foreground mb-6">{state.message}</p>
        <Button onClick={() => setState({ type: 'input' })}>
          Try Again
        </Button>
      </div>
    );
  }

  return null;
}
