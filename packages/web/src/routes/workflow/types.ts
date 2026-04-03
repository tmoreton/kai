import type React from 'react';

export type NodeType = 'trigger' | 'action' | 'condition' | 'delay';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';
export type TriggerType = 'manual' | 'schedule' | 'webhook' | 'event';
export type ActionType = 'send_email' | 'call_api' | 'run_tool' | 'notify' | 'execute_code';

export interface WorkflowNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  label: string;
  config: NodeConfig;
}

export interface NodeConfig {
  triggerType?: TriggerType;
  schedule?: string;
  webhookUrl?: string;
  eventName?: string;
  actionType?: ActionType;
  toolName?: string;
  apiEndpoint?: string;
  emailTo?: string;
  emailSubject?: string;
  code?: string;
  condition?: string;
  operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'matches';
  value?: string;
  duration?: number;
  unit?: 'seconds' | 'minutes' | 'hours' | 'days';
}

export interface Connection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromPort: 'output' | 'true' | 'false';
  toPort: 'input';
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  nodes: WorkflowNode[];
  connections: Connection[];
}

export interface ExecutionLog {
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

export interface ExecutionStep {
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

export interface WorkflowData {
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
