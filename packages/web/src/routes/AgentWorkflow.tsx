import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { 
  Save, 
  Play, 
  Download, 
  Upload, 
  Plus, 
  Trash2, 
  Clock, 
  Zap, 
  Settings, 
  GitBranch, 
  X,
  History,
  Copy,
  Check,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { WorkflowEditor } from '../components/WorkflowEditor';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { cn } from '../lib/utils';

// =============================================================================
// API Configuration
// =============================================================================

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function fetchWorkflow(agentId: string): Promise<WorkflowData | null> {
  const response = await fetch(`${API_BASE_URL}/api/agents/${agentId}/workflow`);
  if (response.status === 404) {
    return null; // No workflow exists yet
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch workflow: ${response.statusText}`);
  }
  return response.json();
}

async function saveWorkflowBackend(agentId: string, workflow: WorkflowData): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/agents/${agentId}/workflow`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(workflow),
  });
  if (!response.ok) {
    throw new Error(`Failed to save workflow: ${response.statusText}`);
  }
}

// =============================================================================
// Types
// =============================================================================

type NodeType = 'trigger' | 'action' | 'condition' | 'delay';
type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';
type TriggerType = 'manual' | 'schedule' | 'webhook' | 'event';
type ActionType = 'send_email' | 'call_api' | 'run_tool' | 'notify' | 'execute_code';

interface WorkflowNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  label: string;
  config: NodeConfig;
}

interface NodeConfig {
  // Trigger config
  triggerType?: TriggerType;
  schedule?: string;
  webhookUrl?: string;
  eventName?: string;
  
  // Action config
  actionType?: ActionType;
  toolName?: string;
  apiEndpoint?: string;
  emailTo?: string;
  emailSubject?: string;
  code?: string;
  
  // Condition config
  condition?: string;
  operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'matches';
  value?: string;
  
  // Delay config
  duration?: number;
  unit?: 'seconds' | 'minutes' | 'hours' | 'days';
}

interface Connection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromPort: 'output' | 'true' | 'false';
  toPort: 'input';
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  nodes: WorkflowNode[];
  connections: Connection[];
}

interface ExecutionLog {
  id: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  steps: ExecutionStep[];
  triggerSource?: string;
}

interface ExecutionStep {
  id: string;
  nodeId: string;
  nodeName: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
  duration?: number;
}

interface WorkflowData {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  connections: Connection[];
  createdAt: string;
  updatedAt: string;
  version: string;
  enabled: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const NODE_TYPE_CONFIG: Record<NodeType, { 
  label: string; 
  color: string; 
  icon: React.ReactNode; 
  description: string;
  ports: string[];
}> = {
  trigger: {
    label: 'Trigger',
    color: '#10b981',
    icon: <Zap className="w-4 h-4" />,
    description: 'Start workflow on schedule, webhook, or event',
    ports: ['output'],
  },
  action: {
    label: 'Action',
    color: '#3b82f6',
    icon: <Settings className="w-4 h-4" />,
    description: 'Execute tools, API calls, or custom code',
    ports: ['input', 'output'],
  },
  condition: {
    label: 'Condition',
    color: '#f59e0b',
    icon: <GitBranch className="w-4 h-4" />,
    description: 'Branch based on if/else logic',
    ports: ['input', 'true', 'false'],
  },
  delay: {
    label: 'Delay',
    color: '#8b5cf6',
    icon: <Clock className="w-4 h-4" />,
    description: 'Wait for a specified duration',
    ports: ['input', 'output'],
  },
};

const TRIGGER_TYPES: { value: TriggerType; label: string; description: string }[] = [
  { value: 'manual', label: 'Manual', description: 'Run manually from dashboard' },
  { value: 'schedule', label: 'Schedule', description: 'Run on a cron schedule' },
  { value: 'webhook', label: 'Webhook', description: 'Trigger via HTTP webhook' },
  { value: 'event', label: 'Event', description: 'React to system events' },
];

const ACTION_TYPES: { value: ActionType; label: string; description: string }[] = [
  { value: 'send_email', label: 'Send Email', description: 'Send an email notification' },
  { value: 'call_api', label: 'Call API', description: 'Make HTTP API request' },
  { value: 'run_tool', label: 'Run Tool', description: 'Execute a tool/command' },
  { value: 'notify', label: 'Notify', description: 'Send push notification' },
  { value: 'execute_code', label: 'Execute Code', description: 'Run custom code' },
];

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'blank',
    name: 'Blank Workflow',
    description: 'Start from scratch',
    icon: <Plus className="w-5 h-5" />,
    nodes: [],
    connections: [],
  },
  {
    id: 'scheduled-report',
    name: 'Scheduled Report',
    description: 'Run daily reports and email results',
    icon: <Clock className="w-5 h-5" />,
    nodes: [
      { id: 'trigger_1', type: 'trigger', x: 300, y: 50, label: 'Daily at 9am', config: { triggerType: 'schedule', schedule: '0 9 * * *' } },
      { id: 'action_1', type: 'action', x: 300, y: 200, label: 'Generate Report', config: { actionType: 'run_tool', toolName: 'generate_report' } },
      { id: 'action_2', type: 'action', x: 300, y: 350, label: 'Email Report', config: { actionType: 'send_email', emailTo: 'team@example.com' } },
    ],
    connections: [
      { id: 'conn_1', fromNodeId: 'trigger_1', toNodeId: 'action_1', fromPort: 'output', toPort: 'input' },
      { id: 'conn_2', fromNodeId: 'action_1', toNodeId: 'action_2', fromPort: 'output', toPort: 'input' },
    ],
  },
  {
    id: 'webhook-processor',
    name: 'Webhook Processor',
    description: 'Process incoming webhooks with conditions',
    icon: <Zap className="w-5 h-5" />,
    nodes: [
      { id: 'trigger_1', type: 'trigger', x: 300, y: 50, label: 'Webhook', config: { triggerType: 'webhook' } },
      { id: 'condition_1', type: 'condition', x: 300, y: 200, label: 'Valid Payload?', config: { condition: 'payload.valid === true' } },
      { id: 'action_1', type: 'action', x: 150, y: 350, label: 'Process Data', config: { actionType: 'run_tool' } },
      { id: 'action_2', type: 'action', x: 450, y: 350, label: 'Log Error', config: { actionType: 'notify' } },
    ],
    connections: [
      { id: 'conn_1', fromNodeId: 'trigger_1', toNodeId: 'condition_1', fromPort: 'output', toPort: 'input' },
      { id: 'conn_2', fromNodeId: 'condition_1', toNodeId: 'action_1', fromPort: 'true', toPort: 'input' },
      { id: 'conn_3', fromNodeId: 'condition_1', toNodeId: 'action_2', fromPort: 'false', toPort: 'input' },
    ],
  },
  {
    id: 'conditional-alerts',
    name: 'Conditional Alerts',
    description: 'Monitor and alert based on conditions',
    icon: <AlertCircle className="w-5 h-5" />,
    nodes: [
      { id: 'trigger_1', type: 'trigger', x: 300, y: 50, label: 'Every 5 min', config: { triggerType: 'schedule', schedule: '*/5 * * * *' } },
      { id: 'action_1', type: 'action', x: 300, y: 180, label: 'Check Metric', config: { actionType: 'call_api' } },
      { id: 'condition_1', type: 'condition', x: 300, y: 310, label: 'Threshold > 90?', config: { condition: 'metric > 90' } },
      { id: 'delay_1', type: 'delay', x: 150, y: 440, label: 'Wait 2 min', config: { duration: 2, unit: 'minutes' } },
      { id: 'action_2', type: 'action', x: 150, y: 570, label: 'Send Alert', config: { actionType: 'send_email' } },
    ],
    connections: [
      { id: 'conn_1', fromNodeId: 'trigger_1', toNodeId: 'action_1', fromPort: 'output', toPort: 'input' },
      { id: 'conn_2', fromNodeId: 'action_1', toNodeId: 'condition_1', fromPort: 'output', toPort: 'input' },
      { id: 'conn_3', fromNodeId: 'condition_1', toNodeId: 'delay_1', fromPort: 'true', toPort: 'input' },
      { id: 'conn_4', fromNodeId: 'delay_1', toNodeId: 'action_2', fromPort: 'output', toPort: 'input' },
    ],
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

const generateId = (): string => `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const generateExecutionId = (): string => `exec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

// =============================================================================
// Components
// =============================================================================

export function AgentWorkflow() {
  const { agentId } = useParams<{ agentId?: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  
  const [workflow, setWorkflow] = useState<WorkflowData>({
    id: agentId || generateId(),
    name: 'New Agent Workflow',
    description: '',
    nodes: [
      {
        id: 'trigger_1',
        type: 'trigger',
        x: 300,
        y: 50,
        label: 'On Start',
        config: { triggerType: 'manual' },
      },
    ],
    connections: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: '1.0',
    enabled: true,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'editor' | 'logs'>('editor');
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  
  // Loading and feedback states
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // -------------------------------------------------------------------------
  // Load Workflow from Backend
  // -------------------------------------------------------------------------
  
  useEffect(() => {
    if (!agentId) return;
    
    const loadWorkflow = async () => {
      setIsLoading(true);
      setLoadError(null);
      
      try {
        const data = await fetchWorkflow(agentId);
        if (data) {
          setWorkflow(data);
        }
        // If no workflow exists (404), keep the default workflow
      } catch (error) {
        console.error('Failed to load workflow:', error);
        setLoadError(error instanceof Error ? error.message : 'Failed to load workflow');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadWorkflow();
  }, [agentId]);

  // -------------------------------------------------------------------------
  // Derived State
  // -------------------------------------------------------------------------
  
  const selectedNode = workflow.nodes.find((n) => n.id === selectedNodeId);

  // -------------------------------------------------------------------------
  // Workflow Operations
  // -------------------------------------------------------------------------

  const updateWorkflowName = useCallback((name: string) => {
    setWorkflow((prev) => ({ ...prev, name, updatedAt: new Date().toISOString() }));
  }, []);

  const addNode = useCallback((type: NodeType) => {
    const config: NodeConfig = {};
    
    switch (type) {
      case 'trigger':
        config.triggerType = 'manual';
        break;
      case 'action':
        config.actionType = 'run_tool';
        break;
      case 'condition':
        config.condition = 'value > 0';
        break;
      case 'delay':
        config.duration = 5;
        config.unit = 'minutes';
        break;
    }

    const newNode: WorkflowNode = {
      id: generateId(),
      type,
      x: 150 + Math.random() * 300,
      y: 150 + Math.random() * 200,
      label: NODE_TYPE_CONFIG[type].label,
      config,
    };

    setWorkflow((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
      updatedAt: new Date().toISOString(),
    }));
    setSelectedNodeId(newNode.id);
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      connections: prev.connections.filter(
        (c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId
      ),
      updatedAt: new Date().toISOString(),
    }));
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
  }, [selectedNodeId]);

  const updateNode = useCallback((nodeId: string, updates: Partial<WorkflowNode>) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === nodeId ? { ...n, ...updates } : n
      ),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateNodeConfig = useCallback((nodeId: string, configUpdates: Partial<NodeConfig>) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === nodeId ? { ...n, config: { ...n.config, ...configUpdates } } : n
      ),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const addConnection = useCallback((connection: Connection) => {
    setWorkflow((prev) => ({
      ...prev,
      connections: [...prev.connections, connection],
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const deleteConnection = useCallback((connectionId: string) => {
    setWorkflow((prev) => ({
      ...prev,
      connections: prev.connections.filter((c) => c.id !== connectionId),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const loadTemplate = useCallback((template: WorkflowTemplate) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: template.nodes.map((n) => ({ ...n, id: generateId() })),
      connections: [],
      updatedAt: new Date().toISOString(),
    }));
    setShowTemplates(false);
    setSelectedNodeId(null);
  }, []);

  const clearWorkflow = useCallback(() => {
    if (confirm('Are you sure you want to clear all nodes?')) {
      setWorkflow((prev) => ({
        ...prev,
        nodes: [],
        connections: [],
        updatedAt: new Date().toISOString(),
      }));
      setSelectedNodeId(null);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Save / Load
  // -------------------------------------------------------------------------

  // Export workflow to file (download)
  const exportWorkflow = useCallback(() => {
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflow.name.replace(/\s+/g, '_').toLowerCase()}_workflow.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [workflow]);

  // Save workflow to backend
  const saveWorkflow = useCallback(async () => {
    if (!agentId) {
      setSaveError('No agent ID available');
      return;
    }
    
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    
    try {
      await saveWorkflowBackend(agentId, workflow);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Failed to save workflow:', error);
      setSaveError(error instanceof Error ? error.message : 'Failed to save workflow');
    } finally {
      setIsSaving(false);
    }
  }, [agentId, workflow]);

  const loadWorkflow = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as WorkflowData;
        if (data.nodes && Array.isArray(data.nodes)) {
          setWorkflow({
            ...data,
            id: data.id || generateId(),
            updatedAt: new Date().toISOString(),
          });
          setSelectedNodeId(null);
        }
      } catch (error) {
        alert('Failed to load workflow: Invalid file format');
      }
    };
    reader.readAsText(file);
  }, []);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(workflow, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [workflow]);

  // -------------------------------------------------------------------------
  // Test Run
  // -------------------------------------------------------------------------

  const runWorkflow = useCallback(async () => {
    if (isRunning) return;
    
    setIsRunning(true);
    const executionId = generateExecutionId();
    
    const newLog: ExecutionLog = {
      id: executionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: 'running',
      startedAt: new Date().toISOString(),
      triggerSource: 'manual',
      steps: [],
    };

    setLogs((prev) => [newLog, ...prev]);
    setActiveTab('logs');
    setSelectedLogId(executionId);

    // Simulate execution
    const executeStep = async (node: WorkflowNode, index: number): Promise<ExecutionStep> => {
      const stepId = `step_${Date.now()}_${index}`;
      const startedAt = new Date().toISOString();
      
      // Simulate processing time
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));
      
      const completedAt = new Date().toISOString();
      const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      
      return {
        id: stepId,
        nodeId: node.id,
        nodeName: node.label,
        status: Math.random() > 0.1 ? 'completed' : 'failed',
        startedAt,
        completedAt,
        output: `Executed ${node.type} node: ${node.label}`,
        duration,
      };
    };

    try {
      // Execute nodes in order (simplified - doesn't follow actual connections)
      const executedNodes: WorkflowNode[] = [];
      for (const node of workflow.nodes) {
        const step = await executeStep(node, executedNodes.length);
        executedNodes.push(node);
        
        setLogs((prev) =>
          prev.map((log) =>
            log.id === executionId
              ? { ...log, steps: [...log.steps, step] }
              : log
          )
        );

        if (step.status === 'failed') {
          throw new Error(`Step failed: ${step.nodeName}`);
        }
      }

      setLogs((prev) =>
        prev.map((log) =>
          log.id === executionId
            ? { ...log, status: 'completed', completedAt: new Date().toISOString() }
            : log
        )
      );
    } catch (error) {
      setLogs((prev) =>
        prev.map((log) =>
          log.id === executionId
            ? {
                ...log,
                status: 'failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                completedAt: new Date().toISOString(),
              }
            : log
        )
      );
    } finally {
      setIsRunning(false);
    }
  }, [workflow, isRunning]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full bg-kai-bg overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <BotIcon />
            <Input
              value={workflow.name}
              onChange={(e) => updateWorkflowName(e.target.value)}
              className="w-64 font-medium"
              placeholder="Workflow name"
            />
          </div>
          <div className="h-6 w-px bg-kai-border" />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTemplates(!showTemplates)}
            >
              <Plus className="w-4 h-4 mr-1" />
              Template
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearWorkflow}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Clear
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-1" />
            Load
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={(e) => e.target.files?.[0] && loadWorkflow(e.target.files[0])}
            className="hidden"
          />
          <Button variant="outline" size="sm" onClick={exportWorkflow}>
            <Download className="w-4 h-4 mr-1" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={copyToClipboard}>
            {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <div className="h-6 w-px bg-kai-border mx-1" />
          <Button
            variant="secondary"
            size="sm"
            onClick={runWorkflow}
            disabled={isRunning || workflow.nodes.length === 0}
          >
            <Play className={cn("w-4 h-4 mr-1", isRunning && "animate-pulse")} />
            {isRunning ? 'Running...' : 'Test Run'}
          </Button>
          <Button size="sm" onClick={saveWorkflow} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : saveSuccess ? (
              <Check className="w-4 h-4 mr-1" />
            ) : (
              <Save className="w-4 h-4 mr-1" />
            )}
            {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save'}
          </Button>
        </div>
      </header>

      {/* Template Selector Dropdown */}
      {showTemplates && (
        <div className="absolute top-14 left-4 z-50 w-80 bg-card border border-border rounded-xl shadow-lg">
          <div className="p-3 border-b border-border">
            <h3 className="font-semibold text-kai-text">Choose Template</h3>
          </div>
          <div className="p-2 space-y-1">
            {WORKFLOW_TEMPLATES.map((template) => (
              <button
                key={template.id}
                onClick={() => loadTemplate(template)}
                className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-accent/10 text-left transition-colors"
              >
                <div className="p-2 bg-accent/10 rounded-lg text-primary">
                  {template.icon}
                </div>
                <div>
                  <div className="font-medium text-kai-text">{template.name}</div>
                  <div className="text-sm text-muted-foreground">{template.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error/Success Messages */}
      {(loadError || saveError) && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-kai-red/20">
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4" />
            {loadError || saveError}
          </div>
        </div>
      )}
      {saveSuccess && !saveError && (
        <div className="px-4 py-2 bg-kai-green-light border-b border-kai-green/20">
          <div className="flex items-center gap-2 text-green-500 text-sm">
            <Check className="w-4 h-4" />
            Workflow saved successfully
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-50 bg-kai-bg/80 flex items-center justify-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Loading workflow...</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Node Palette */}
        <aside className="w-64 flex-shrink-0 bg-card border-r border-border flex flex-col">
          <div className="p-3 border-b border-border">
            <h3 className="font-semibold text-kai-text text-sm">Node Palette</h3>
            <p className="text-xs text-muted-foreground mt-1">Drag nodes to canvas</p>
          </div>
          <div className="p-3 space-y-2 overflow-y-auto">
            {(Object.entries(NODE_TYPE_CONFIG) as [NodeType, typeof NODE_TYPE_CONFIG['trigger']][]).map(
              ([type, config]) => (
                <button
                  key={type}
                  onClick={() => addNode(type)}
                  className="w-full flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary hover:bg-accent/10 transition-all text-left group"
                >
                  <div
                    className="p-2 rounded-lg flex-shrink-0"
                    style={{ backgroundColor: `${config.color}15`, color: config.color }}
                  >
                    {config.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-kai-text text-sm">{config.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {config.description}
                    </div>
                  </div>
                  <Plus className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </button>
              )
            )}
          </div>

          {/* Help Section */}
          <div className="mt-auto p-3 border-t border-border">
            <div className="text-xs text-muted-foreground space-y-1">
              <p>• Click to add nodes</p>
              <p>• Drag to reposition</p>
              <p>• Connect ports to link</p>
            </div>
          </div>
        </aside>

        {/* Center - Canvas */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          <div className="flex items-center gap-1 px-4 py-2 bg-card border-b border-border">
            <button
              onClick={() => setActiveTab('editor')}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                activeTab === 'editor'
                  ? "bg-accent/20 text-kai-text"
                  : "text-muted-foreground hover:text-kai-text hover:bg-accent/10"
              )}
            >
              Editor
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-2",
                activeTab === 'logs'
                  ? "bg-accent/20 text-kai-text"
                  : "text-muted-foreground hover:text-kai-text hover:bg-accent/10"
              )}
            >
              Execution History
              {logs.length > 0 && (
                <span className="px-1.5 py-0.5 bg-kai-teal text-white text-xs rounded-full">
                  {logs.length}
                </span>
              )}
            </button>
          </div>

          {/* Canvas Area */}
          {activeTab === 'editor' ? (
            <div className="flex-1 relative overflow-hidden">
              <WorkflowEditor
                nodes={workflow.nodes}
                connections={workflow.connections}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onUpdateNodes={(nodes) =>
                  setWorkflow((prev) => ({ ...prev, nodes, updatedAt: new Date().toISOString() }))
                }
                onAddConnection={addConnection}
                onDeleteConnection={deleteConnection}
                onDeleteNode={deleteNode}
              />
            </div>
          ) : (
            <ExecutionLogsPanel
              logs={logs}
              selectedLogId={selectedLogId}
              onSelectLog={setSelectedLogId}
            />
          )}
        </main>

        {/* Right Sidebar - Properties */}
        <aside
          className={cn(
            "w-80 flex-shrink-0 bg-card border-l border-border flex flex-col transition-all duration-300",
            !selectedNode && "w-0 overflow-hidden opacity-0"
          )}
        >
          {selectedNode && (
            <>
              <div className="flex items-center justify-between p-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <div
                    className="p-1.5 rounded"
                    style={{
                      backgroundColor: `${NODE_TYPE_CONFIG[selectedNode.type].color}15`,
                      color: NODE_TYPE_CONFIG[selectedNode.type].color,
                    }}
                  >
                    {NODE_TYPE_CONFIG[selectedNode.type].icon}
                  </div>
                  <h3 className="font-semibold text-kai-text">
                    {NODE_TYPE_CONFIG[selectedNode.type].label} Properties
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedNodeId(null)}
                  className="p-1.5 rounded hover:bg-accent/10 text-muted-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Node Label */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Label
                  </label>
                  <Input
                    value={selectedNode.label}
                    onChange={(e) => updateNode(selectedNode.id, { label: e.target.value })}
                    placeholder="Node label"
                  />
                </div>

                {/* Node Type Specific Config */}
                {selectedNode.type === 'trigger' && (
                  <TriggerConfig 
                    config={selectedNode.config} 
                    onChange={(config) => updateNodeConfig(selectedNode.id, config)} 
                  />
                )}
                {selectedNode.type === 'action' && (
                  <ActionConfig 
                    config={selectedNode.config} 
                    onChange={(config) => updateNodeConfig(selectedNode.id, config)} 
                  />
                )}
                {selectedNode.type === 'condition' && (
                  <ConditionConfig 
                    config={selectedNode.config} 
                    onChange={(config) => updateNodeConfig(selectedNode.id, config)} 
                  />
                )}
                {selectedNode.type === 'delay' && (
                  <DelayConfig 
                    config={selectedNode.config} 
                    onChange={(config) => updateNodeConfig(selectedNode.id, config)} 
                  />
                )}

                {/* Divider */}
                <div className="border-t border-border" />

                {/* Delete Button */}
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => deleteNode(selectedNode.id)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Node
                </Button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

// =============================================================================
// Sub-Components
// =============================================================================

function BotIcon() {
  return (
    <div className="w-8 h-8 rounded-lg bg-kai-teal flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4" />
        <path d="M8 15h.01" />
        <path d="M16 15h.01" />
      </svg>
    </div>
  );
}

function TriggerConfig({ 
  config, 
  onChange 
}: { 
  config: NodeConfig; 
  onChange: (config: Partial<NodeConfig>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Trigger Type
        </label>
        <select
          value={config.triggerType || 'manual'}
          onChange={(e) => onChange({ triggerType: e.target.value as TriggerType })}
          className="w-full h-9 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-kai-teal"
        >
          {TRIGGER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {TRIGGER_TYPES.find((t) => t.value === config.triggerType)?.description}
        </p>
      </div>

      {config.triggerType === 'schedule' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Cron Schedule
          </label>
          <Input
            value={config.schedule || ''}
            onChange={(e) => onChange({ schedule: e.target.value })}
            placeholder="0 9 * * *"
          />
          <p className="text-xs text-muted-foreground">
            Cron expression (e.g., 0 9 * * * for daily at 9am)
          </p>
        </div>
      )}

      {config.triggerType === 'webhook' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Webhook URL
          </label>
          <Input
            value={config.webhookUrl || ''}
            onChange={(e) => onChange({ webhookUrl: e.target.value })}
            placeholder="/webhooks/my-workflow"
          />
        </div>
      )}

      {config.triggerType === 'event' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Event Name
          </label>
          <Input
            value={config.eventName || ''}
            onChange={(e) => onChange({ eventName: e.target.value })}
            placeholder="user.created"
          />
        </div>
      )}
    </div>
  );
}

function ActionConfig({ 
  config, 
  onChange 
}: { 
  config: NodeConfig; 
  onChange: (config: Partial<NodeConfig>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Action Type
        </label>
        <select
          value={config.actionType || 'run_tool'}
          onChange={(e) => onChange({ actionType: e.target.value as ActionType })}
          className="w-full h-9 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-kai-teal"
        >
          {ACTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {config.actionType === 'run_tool' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Tool Name
          </label>
          <Input
            value={config.toolName || ''}
            onChange={(e) => onChange({ toolName: e.target.value })}
            placeholder="e.g., fetch_data, process_csv"
          />
        </div>
      )}

      {config.actionType === 'call_api' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            API Endpoint
          </label>
          <Input
            value={config.apiEndpoint || ''}
            onChange={(e) => onChange({ apiEndpoint: e.target.value })}
            placeholder="https://api.example.com/data"
          />
        </div>
      )}

      {config.actionType === 'send_email' && (
        <>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              To
            </label>
            <Input
              value={config.emailTo || ''}
              onChange={(e) => onChange({ emailTo: e.target.value })}
              placeholder="recipient@example.com"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Subject
            </label>
            <Input
              value={config.emailSubject || ''}
              onChange={(e) => onChange({ emailSubject: e.target.value })}
              placeholder="Email subject"
            />
          </div>
        </>
      )}

      {config.actionType === 'execute_code' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Code
          </label>
          <textarea
            value={config.code || ''}
            onChange={(e) => onChange({ code: e.target.value })}
            placeholder="// Enter your code here"
            className="w-full h-32 px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono focus:outline-none focus:ring-1 focus:ring-kai-teal resize-none"
          />
        </div>
      )}
    </div>
  );
}

function ConditionConfig({ 
  config, 
  onChange 
}: { 
  config: NodeConfig; 
  onChange: (config: Partial<NodeConfig>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Condition Expression
        </label>
        <Input
          value={config.condition || ''}
          onChange={(e) => onChange({ condition: e.target.value })}
          placeholder="value > 0"
        />
        <p className="text-xs text-muted-foreground">
          JavaScript expression that evaluates to true or false
        </p>
      </div>

      <div className="p-3 bg-accent/10 rounded-lg">
        <p className="text-xs text-muted-foreground">
          <strong>True</strong> branch executes if condition is true
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          <strong>False</strong> branch executes if condition is false
        </p>
      </div>
    </div>
  );
}

function DelayConfig({ 
  config, 
  onChange 
}: { 
  config: NodeConfig; 
  onChange: (config: Partial<NodeConfig>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1 space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Duration
          </label>
          <Input
            type="number"
            min={1}
            value={config.duration || 5}
            onChange={(e) => onChange({ duration: parseInt(e.target.value) || 1 })}
          />
        </div>
        <div className="w-28 space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Unit
          </label>
          <select
            value={config.unit || 'minutes'}
            onChange={(e) => onChange({ unit: e.target.value as NodeConfig['unit'] })}
            className="w-full h-9 px-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-kai-teal"
          >
            <option value="seconds">Seconds</option>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function ExecutionLogsPanel({
  logs,
  selectedLogId,
  onSelectLog,
}: {
  logs: ExecutionLog[];
  selectedLogId: string | null;
  onSelectLog: (id: string) => void;
}) {
  const selectedLog = logs.find((l) => l.id === selectedLogId);

  return (
    <div className="flex h-full">
      {/* Logs List */}
      <div className="w-80 flex-shrink-0 border-r border-border bg-card overflow-y-auto">
        <div className="p-3 border-b border-border">
          <h3 className="font-semibold text-kai-text text-sm flex items-center gap-2">
            <History className="w-4 h-4" />
            Execution History
          </h3>
        </div>
        
        {logs.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground">No executions yet</p>
            <p className="text-xs text-muted-foreground mt-1">Run your workflow to see logs</p>
          </div>
        ) : (
          <div className="divide-y divide-kai-border">
            {logs.map((log) => (
              <button
                key={log.id}
                onClick={() => onSelectLog(log.id)}
                className={cn(
                  "w-full p-3 text-left hover:bg-accent/10 transition-colors",
                  selectedLogId === log.id && "bg-accent/20"
                )}
              >
                <div className="flex items-center gap-2">
                  <ExecutionStatusBadge status={log.status} />
                  <span className="text-sm font-medium text-kai-text truncate">
                    Run #{log.id.slice(-6)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.startedAt).toLocaleString()}
                  </span>
                  {log.steps.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      • {log.steps.length} steps
                    </span>
                  )}
                </div>
                {log.error && (
                  <p className="text-xs text-destructive mt-1 truncate">{log.error}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Log Details */}
      <div className="flex-1 overflow-y-auto bg-kai-bg">
        {selectedLog ? (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold text-kai-text">
                  Execution Run #{selectedLog.id.slice(-6)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {new Date(selectedLog.startedAt).toLocaleString()}
                </p>
              </div>
              <ExecutionStatusBadge status={selectedLog.status} size="lg" />
            </div>

            {/* Timeline */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-sm">Execution Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {selectedLog.steps.map((step, index) => (
                    <div key={step.id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                            step.status === 'completed'
                              ? "bg-kai-green-light text-green-500"
                              : step.status === 'failed'
                              ? "bg-destructive/10 text-destructive"
                              : "bg-accent/10 text-muted-foreground"
                          )}
                        >
                          {index + 1}
                        </div>
                        {index < selectedLog.steps.length - 1 && (
                          <div className="w-px h-full bg-kai-border my-2" />
                        )}
                      </div>
                      <div className="flex-1 pb-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-kai-text">{step.nodeName}</span>
                          <ExecutionStatusBadge status={step.status} />
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {step.output}
                        </p>
                        {step.error && (
                          <p className="text-sm text-destructive mt-1">{step.error}</p>
                        )}
                        {step.duration && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Duration: {(step.duration / 1000).toFixed(2)}s
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Status</p>
                    <p className="text-sm font-medium text-kai-text capitalize">
                      {selectedLog.status}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Trigger</p>
                    <p className="text-sm font-medium text-kai-text capitalize">
                      {selectedLog.triggerSource}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Steps</p>
                    <p className="text-sm font-medium text-kai-text">
                      {selectedLog.steps.length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <History className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">Select a log to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ExecutionStatusBadge({ 
  status, 
  size = 'sm' 
}: { 
  status: ExecutionStatus; 
  size?: 'sm' | 'lg';
}) {
  const config = {
    pending: { color: 'bg-kai-text-muted', text: 'Pending' },
    running: { color: 'bg-kai-teal animate-pulse', text: 'Running' },
    completed: { color: 'bg-kai-green', text: 'Completed' },
    failed: { color: 'bg-kai-red', text: 'Failed' },
  };

  const { color, text } = config[status];

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-white font-medium",
        size === 'lg' ? "text-sm px-3 py-1" : "text-xs",
        color
      )}
    >
      {text}
    </span>
  );
}

// Export types for external use
export type {
  NodeType,
  WorkflowNode,
  Connection,
  WorkflowData,
  ExecutionLog,
  ExecutionStep,
  ExecutionStatus,
  TriggerType,
  ActionType,
  WorkflowTemplate,
  NodeConfig,
};
