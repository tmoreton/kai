import { Zap, Settings, GitBranch, Clock, Plus, AlertCircle } from 'lucide-react';
import type { NodeType, TriggerType, ActionType, WorkflowTemplate } from './types';

export const NODE_TYPE_CONFIG: Record<NodeType, {
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

export const TRIGGER_TYPES: { value: TriggerType; label: string; description: string }[] = [
  { value: 'manual', label: 'Manual', description: 'Run manually from dashboard' },
  { value: 'schedule', label: 'Schedule', description: 'Run on a cron schedule' },
  { value: 'webhook', label: 'Webhook', description: 'Trigger via HTTP webhook' },
  { value: 'event', label: 'Event', description: 'React to system events' },
];

export const ACTION_TYPES: { value: ActionType; label: string; description: string }[] = [
  { value: 'send_email', label: 'Send Email', description: 'Send an email notification' },
  { value: 'call_api', label: 'Call API', description: 'Make HTTP API request' },
  { value: 'run_tool', label: 'Run Tool', description: 'Execute a tool/command' },
  { value: 'notify', label: 'Notify', description: 'Send push notification' },
  { value: 'execute_code', label: 'Execute Code', description: 'Run custom code' },
];

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
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

export const generateId = (): string => `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
export const generateExecutionId = (): string => `exec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
