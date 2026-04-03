import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Save, Play, Download, Upload, Plus, Trash2,
  X, Copy, Check, AlertCircle, Loader2
} from 'lucide-react';
import { WorkflowEditor } from '../components/WorkflowEditor';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';
import { NODE_TYPE_CONFIG, WORKFLOW_TEMPLATES, generateId, generateExecutionId } from './workflow/constants';
import { TriggerConfig, ActionConfig, ConditionConfig, DelayConfig } from './workflow/NodeConfigPanels';
import { ExecutionLogsPanel } from './workflow/ExecutionLogsPanel';
import type {
  NodeType, WorkflowNode, WorkflowData, WorkflowTemplate,
  Connection, NodeConfig, ExecutionLog, ExecutionStep,
} from './workflow/types';

// Re-export types for external use
export type {
  NodeType, WorkflowNode, Connection, WorkflowData,
  ExecutionLog, ExecutionStep, WorkflowTemplate, NodeConfig,
} from './workflow/types';
export type { ExecutionStatus, TriggerType, ActionType } from './workflow/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function fetchWorkflow(agentId: string): Promise<WorkflowData | null> {
  const response = await fetch(`${API_BASE_URL}/api/agents/${agentId}/workflow`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to fetch workflow: ${response.statusText}`);
  return response.json();
}

async function saveWorkflowBackend(agentId: string, workflow: WorkflowData): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/agents/${agentId}/workflow`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workflow),
  });
  if (!response.ok) throw new Error(`Failed to save workflow: ${response.statusText}`);
}

export function AgentWorkflow() {
  const { agentId } = useParams<{ agentId?: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [workflow, setWorkflow] = useState<WorkflowData>({
    id: agentId || generateId(),
    name: 'New Agent Workflow',
    description: '',
    nodes: [{ id: 'trigger_1', type: 'trigger', x: 300, y: 50, label: 'On Start', config: { triggerType: 'manual' } }],
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
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const data = await fetchWorkflow(agentId);
        if (data) setWorkflow(data);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Failed to load workflow');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [agentId]);

  const selectedNode = workflow.nodes.find((n) => n.id === selectedNodeId);

  const updateWorkflowName = useCallback((name: string) => {
    setWorkflow((prev) => ({ ...prev, name, updatedAt: new Date().toISOString() }));
  }, []);

  const addNode = useCallback((type: NodeType) => {
    const config: NodeConfig = {};
    switch (type) {
      case 'trigger': config.triggerType = 'manual'; break;
      case 'action': config.actionType = 'run_tool'; break;
      case 'condition': config.condition = 'value > 0'; break;
      case 'delay': config.duration = 5; config.unit = 'minutes'; break;
    }
    const newNode: WorkflowNode = {
      id: generateId(), type,
      x: 150 + Math.random() * 300, y: 150 + Math.random() * 200,
      label: NODE_TYPE_CONFIG[type].label, config,
    };
    setWorkflow((prev) => ({ ...prev, nodes: [...prev.nodes, newNode], updatedAt: new Date().toISOString() }));
    setSelectedNodeId(newNode.id);
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setWorkflow((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      connections: prev.connections.filter((c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId),
      updatedAt: new Date().toISOString(),
    }));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId]);

  const updateNode = useCallback((nodeId: string, updates: Partial<WorkflowNode>) => {
    setWorkflow((prev) => ({
      ...prev, nodes: prev.nodes.map((n) => n.id === nodeId ? { ...n, ...updates } : n),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateNodeConfig = useCallback((nodeId: string, configUpdates: Partial<NodeConfig>) => {
    setWorkflow((prev) => ({
      ...prev, nodes: prev.nodes.map((n) => n.id === nodeId ? { ...n, config: { ...n.config, ...configUpdates } } : n),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const addConnection = useCallback((connection: Connection) => {
    setWorkflow((prev) => ({ ...prev, connections: [...prev.connections, connection], updatedAt: new Date().toISOString() }));
  }, []);

  const deleteConnection = useCallback((connectionId: string) => {
    setWorkflow((prev) => ({ ...prev, connections: prev.connections.filter((c) => c.id !== connectionId), updatedAt: new Date().toISOString() }));
  }, []);

  const loadTemplate = useCallback((template: WorkflowTemplate) => {
    setWorkflow((prev) => ({ ...prev, nodes: template.nodes.map((n) => ({ ...n, id: generateId() })), connections: [], updatedAt: new Date().toISOString() }));
    setShowTemplates(false);
    setSelectedNodeId(null);
  }, []);

  const clearWorkflow = useCallback(() => {
    if (confirm('Are you sure you want to clear all nodes?')) {
      setWorkflow((prev) => ({ ...prev, nodes: [], connections: [], updatedAt: new Date().toISOString() }));
      setSelectedNodeId(null);
    }
  }, []);

  const exportWorkflow = useCallback(() => {
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflow.name.replace(/\s+/g, '_').toLowerCase()}_workflow.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [workflow]);

  const saveWorkflow = useCallback(async () => {
    if (!agentId) { setSaveError('No agent ID available'); return; }
    setIsSaving(true); setSaveError(null); setSaveSuccess(false);
    try {
      await saveWorkflowBackend(agentId, workflow);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save workflow');
    } finally {
      setIsSaving(false);
    }
  }, [agentId, workflow]);

  const loadWorkflowFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as WorkflowData;
        if (data.nodes && Array.isArray(data.nodes)) {
          setWorkflow({ ...data, id: data.id || generateId(), updatedAt: new Date().toISOString() });
          setSelectedNodeId(null);
        }
      } catch { alert('Failed to load workflow: Invalid file format'); }
    };
    reader.readAsText(file);
  }, []);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(workflow, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [workflow]);

  const runWorkflow = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    const executionId = generateExecutionId();
    const newLog: ExecutionLog = {
      id: executionId, workflowId: workflow.id, workflowName: workflow.name,
      status: 'running', startedAt: new Date().toISOString(), triggerSource: 'manual', steps: [],
    };
    setLogs((prev) => [newLog, ...prev]);
    setActiveTab('logs');
    setSelectedLogId(executionId);

    try {
      for (let i = 0; i < workflow.nodes.length; i++) {
        const node = workflow.nodes[i];
        await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));
        const step: ExecutionStep = {
          id: `step_${Date.now()}_${i}`, nodeId: node.id, nodeName: node.label,
          status: Math.random() > 0.1 ? 'completed' : 'failed',
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
          output: `Executed ${node.type} node: ${node.label}`,
          duration: 500 + Math.random() * 1000,
        };
        setLogs((prev) => prev.map((log) => log.id === executionId ? { ...log, steps: [...log.steps, step] } : log));
        if (step.status === 'failed') throw new Error(`Step failed: ${step.nodeName}`);
      }
      setLogs((prev) => prev.map((log) => log.id === executionId ? { ...log, status: 'completed', completedAt: new Date().toISOString() } : log));
    } catch (error) {
      setLogs((prev) => prev.map((log) => log.id === executionId ? { ...log, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error', completedAt: new Date().toISOString() } : log));
    } finally {
      setIsRunning(false);
    }
  }, [workflow, isRunning]);

  return (
    <div className="flex flex-col h-full bg-kai-bg overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <BotIcon />
            <Input value={workflow.name} onChange={(e) => updateWorkflowName(e.target.value)} className="w-64 font-medium" placeholder="Workflow name" />
          </div>
          <div className="h-6 w-px bg-kai-border" />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowTemplates(!showTemplates)}>
              <Plus className="w-4 h-4 mr-1" />Template
            </Button>
            <Button variant="outline" size="sm" onClick={clearWorkflow} className="text-destructive hover:text-destructive">
              <Trash2 className="w-4 h-4 mr-1" />Clear
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-4 h-4 mr-1" />Load
          </Button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={(e) => e.target.files?.[0] && loadWorkflowFile(e.target.files[0])} className="hidden" />
          <Button variant="outline" size="sm" onClick={exportWorkflow}><Download className="w-4 h-4 mr-1" />Export</Button>
          <Button variant="outline" size="sm" onClick={copyToClipboard}>
            {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <div className="h-6 w-px bg-kai-border mx-1" />
          <Button variant="secondary" size="sm" onClick={runWorkflow} disabled={isRunning || workflow.nodes.length === 0}>
            <Play className={cn("w-4 h-4 mr-1", isRunning && "animate-pulse")} />
            {isRunning ? 'Running...' : 'Test Run'}
          </Button>
          <Button size="sm" onClick={saveWorkflow} disabled={isSaving}>
            {isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : saveSuccess ? <Check className="w-4 h-4 mr-1" /> : <Save className="w-4 h-4 mr-1" />}
            {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save'}
          </Button>
        </div>
      </header>

      {/* Template Selector */}
      {showTemplates && (
        <div className="absolute top-14 left-4 z-50 w-80 bg-card border border-border rounded-xl shadow-lg">
          <div className="p-3 border-b border-border"><h3 className="font-semibold text-kai-text">Choose Template</h3></div>
          <div className="p-2 space-y-1">
            {WORKFLOW_TEMPLATES.map((template) => (
              <button key={template.id} onClick={() => loadTemplate(template)} className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-accent/10 text-left transition-colors">
                <div className="p-2 bg-accent/10 rounded-lg text-primary">{template.icon}</div>
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
          <div className="flex items-center gap-2 text-destructive text-sm"><AlertCircle className="w-4 h-4" />{loadError || saveError}</div>
        </div>
      )}
      {saveSuccess && !saveError && (
        <div className="px-4 py-2 bg-kai-green-light border-b border-kai-green/20">
          <div className="flex items-center gap-2 text-green-500 text-sm"><Check className="w-4 h-4" />Workflow saved successfully</div>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-50 bg-kai-bg/80 flex items-center justify-center">
          <div className="flex items-center gap-3 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /><span>Loading workflow...</span></div>
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
            {(Object.entries(NODE_TYPE_CONFIG) as [NodeType, typeof NODE_TYPE_CONFIG['trigger']][]).map(([type, config]) => (
              <button key={type} onClick={() => addNode(type)} className="w-full flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary hover:bg-accent/10 transition-all text-left group">
                <div className="p-2 rounded-lg flex-shrink-0" style={{ backgroundColor: `${config.color}15`, color: config.color }}>{config.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-kai-text text-sm">{config.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{config.description}</div>
                </div>
                <Plus className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </button>
            ))}
          </div>
          <div className="mt-auto p-3 border-t border-border">
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Click to add nodes</p>
              <p>Drag to reposition</p>
              <p>Connect ports to link</p>
            </div>
          </div>
        </aside>

        {/* Center - Canvas */}
        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-1 px-4 py-2 bg-card border-b border-border">
            <button onClick={() => setActiveTab('editor')} className={cn("px-3 py-1.5 text-sm font-medium rounded-lg transition-colors", activeTab === 'editor' ? "bg-accent/20 text-kai-text" : "text-muted-foreground hover:text-kai-text hover:bg-accent/10")}>
              Editor
            </button>
            <button onClick={() => setActiveTab('logs')} className={cn("px-3 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-2", activeTab === 'logs' ? "bg-accent/20 text-kai-text" : "text-muted-foreground hover:text-kai-text hover:bg-accent/10")}>
              Execution History
              {logs.length > 0 && <span className="px-1.5 py-0.5 bg-kai-teal text-white text-xs rounded-full">{logs.length}</span>}
            </button>
          </div>

          {activeTab === 'editor' ? (
            <div className="flex-1 relative overflow-hidden">
              <WorkflowEditor
                nodes={workflow.nodes} connections={workflow.connections}
                selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId}
                onUpdateNodes={(nodes) => setWorkflow((prev) => ({ ...prev, nodes, updatedAt: new Date().toISOString() }))}
                onAddConnection={addConnection} onDeleteConnection={deleteConnection} onDeleteNode={deleteNode}
              />
            </div>
          ) : (
            <ExecutionLogsPanel logs={logs} selectedLogId={selectedLogId} onSelectLog={setSelectedLogId} />
          )}
        </main>

        {/* Right Sidebar - Properties */}
        <aside className={cn("w-80 flex-shrink-0 bg-card border-l border-border flex flex-col transition-all duration-300", !selectedNode && "w-0 overflow-hidden opacity-0")}>
          {selectedNode && (
            <>
              <div className="flex items-center justify-between p-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded" style={{ backgroundColor: `${NODE_TYPE_CONFIG[selectedNode.type].color}15`, color: NODE_TYPE_CONFIG[selectedNode.type].color }}>
                    {NODE_TYPE_CONFIG[selectedNode.type].icon}
                  </div>
                  <h3 className="font-semibold text-kai-text">{NODE_TYPE_CONFIG[selectedNode.type].label} Properties</h3>
                </div>
                <button onClick={() => setSelectedNodeId(null)} className="p-1.5 rounded hover:bg-accent/10 text-muted-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Label</label>
                  <Input value={selectedNode.label} onChange={(e) => updateNode(selectedNode.id, { label: e.target.value })} placeholder="Node label" />
                </div>
                {selectedNode.type === 'trigger' && <TriggerConfig config={selectedNode.config} onChange={(config) => updateNodeConfig(selectedNode.id, config)} />}
                {selectedNode.type === 'action' && <ActionConfig config={selectedNode.config} onChange={(config) => updateNodeConfig(selectedNode.id, config)} />}
                {selectedNode.type === 'condition' && <ConditionConfig config={selectedNode.config} onChange={(config) => updateNodeConfig(selectedNode.id, config)} />}
                {selectedNode.type === 'delay' && <DelayConfig config={selectedNode.config} onChange={(config) => updateNodeConfig(selectedNode.id, config)} />}
                <div className="border-t border-border" />
                <Button variant="destructive" className="w-full" onClick={() => deleteNode(selectedNode.id)}>
                  <Trash2 className="w-4 h-4 mr-2" />Delete Node
                </Button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function BotIcon() {
  return (
    <div className="w-8 h-8 rounded-lg bg-kai-teal flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4" /><path d="M8 15h.01" /><path d="M16 15h.01" />
      </svg>
    </div>
  );
}
