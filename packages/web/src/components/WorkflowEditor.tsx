import React, { useState, useRef, useCallback, useEffect } from 'react';
import './WorkflowEditor.css';

// =============================================================================
// Types
// =============================================================================

type NodeType = 'trigger' | 'action' | 'condition' | 'delay';

interface WorkflowNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  label: string;
  config: Record<string, any>;
}

interface Connection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromPort: 'output' | 'true' | 'false';
  toPort: 'input';
}

interface DragState {
  isDragging: boolean;
  nodeId: string | null;
  offsetX: number;
  offsetY: number;
}

interface ConnectionDragState {
  isDragging: boolean;
  fromNodeId: string | null;
  fromPort: 'output' | 'true' | 'false' | null;
  currentX: number;
  currentY: number;
}

interface WorkflowEditorProps {
  nodes?: WorkflowNode[];
  connections?: Connection[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  onUpdateNodes?: (nodes: WorkflowNode[]) => void;
  onAddConnection?: (connection: Connection) => void;
  onDeleteConnection?: (connectionId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  readOnly?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;

const NODE_TYPE_CONFIG: Record<NodeType, { label: string; color: string; icon: string; ports: string[] }> = {
  trigger: {
    label: 'Trigger',
    color: '#10b981',
    icon: '⚡',
    ports: ['output'],
  },
  action: {
    label: 'Action',
    color: '#3b82f6',
    icon: '⚙️',
    ports: ['input', 'output'],
  },
  condition: {
    label: 'Condition',
    color: '#f59e0b',
    icon: '🔀',
    ports: ['input', 'true', 'false'],
  },
  delay: {
    label: 'Delay',
    color: '#8b5cf6',
    icon: '⏱️',
    ports: ['input', 'output'],
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

const generateId = () => `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const getPortPosition = (node: WorkflowNode, port: string): { x: number; y: number } => {
  const centerX = node.x + NODE_WIDTH / 2;
  const centerY = node.y + NODE_HEIGHT / 2;
  
  switch (port) {
    case 'input':
      return { x: centerX, y: node.y };
    case 'output':
    case 'true':
      return { x: centerX, y: node.y + NODE_HEIGHT };
    case 'false':
      return { x: node.x + NODE_WIDTH, y: centerY };
    default:
      return { x: centerX, y: centerY };
  }
};

const createCurvedPath = (x1: number, y1: number, x2: number, y2: number): string => {
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
};

// =============================================================================
// Component
// =============================================================================

export const WorkflowEditor: React.FC<WorkflowEditorProps> = ({
  nodes: externalNodes,
  connections: externalConnections,
  selectedNodeId: externalSelectedNodeId,
  onSelectNode,
  onUpdateNodes,
  onAddConnection,
  onDeleteConnection,
  onDeleteNode,
  readOnly = false,
}) => {
  // -------------------------------------------------------------------------
  // State (use external if provided, otherwise internal)
  // -------------------------------------------------------------------------
  
  const [internalNodes, setInternalNodes] = useState<WorkflowNode[]>([
    {
      id: 'trigger_1',
      type: 'trigger',
      x: 300,
      y: 50,
      label: 'On Start',
      config: { triggerType: 'manual' },
    },
  ]);
  
  const [internalConnections, setInternalConnections] = useState<Connection[]>([]);
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(null);
  
  // Use external state if provided, otherwise internal
  const nodes = externalNodes ?? internalNodes;
  const connections = externalConnections ?? internalConnections;
  const selectedNodeId = externalSelectedNodeId ?? internalSelectedNodeId;
  
  const setNodes = useCallback((updater: React.SetStateAction<WorkflowNode[]>) => {
    const newNodes = typeof updater === 'function' ? updater(nodes) : updater;
    if (onUpdateNodes) {
      onUpdateNodes(newNodes);
    } else {
      setInternalNodes(newNodes);
    }
  }, [nodes, onUpdateNodes]);
  
  const setConnections = useCallback((updater: React.SetStateAction<Connection[]>) => {
    const newConnections = typeof updater === 'function' ? updater(connections) : updater;
    if (onUpdateNodes) {
      // In controlled mode, we don't set internal connections
      setInternalConnections(newConnections);
    } else {
      setInternalConnections(newConnections);
    }
  }, [connections, onUpdateNodes]);
  
  const setSelectedNodeId = useCallback((id: string | null) => {
    if (onSelectNode) {
      onSelectNode(id);
    } else {
      setInternalSelectedNodeId(id);
    }
  }, [onSelectNode]);

  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    nodeId: null,
    offsetX: 0,
    offsetY: 0,
  });
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDragState>({
    isDragging: false,
    fromNodeId: null,
    fromPort: null,
    currentX: 0,
    currentY: 0,
  });
  const [showGrid, setShowGrid] = useState(true);
  const [scale, setScale] = useState(1);
  
  const canvasRef = useRef<HTMLDivElement>(null);

  // -------------------------------------------------------------------------
  // Drag & Drop Handlers
  // -------------------------------------------------------------------------
  
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if (readOnly) return;
    e.stopPropagation();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    setDragState({
      isDragging: true,
      nodeId,
      offsetX: (e.clientX - rect.left) / scale - node.x,
      offsetY: (e.clientY - rect.top) / scale - node.y,
    });
    setSelectedNodeId(nodeId);
  }, [nodes, scale, setSelectedNodeId, readOnly]);
  
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / scale;
    const mouseY = (e.clientY - rect.top) / scale;
    
    // Handle node dragging
    if (dragState.isDragging && dragState.nodeId) {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === dragState.nodeId
            ? {
                ...n,
                x: Math.max(0, mouseX - dragState.offsetX),
                y: Math.max(0, mouseY - dragState.offsetY),
              }
            : n
        )
      );
    }
    
    // Handle connection dragging
    if (connectionDrag.isDragging) {
      setConnectionDrag((prev) => ({
        ...prev,
        currentX: mouseX,
        currentY: mouseY,
      }));
    }
  }, [dragState, connectionDrag.isDragging, scale, setNodes]);
  
  const handleCanvasMouseUp = useCallback(() => {
    setDragState({
      isDragging: false,
      nodeId: null,
      offsetX: 0,
      offsetY: 0,
    });
    
    if (connectionDrag.isDragging) {
      setConnectionDrag({
        isDragging: false,
        fromNodeId: null,
        fromPort: null,
        currentX: 0,
        currentY: 0,
      });
    }
  }, [connectionDrag.isDragging]);

  // -------------------------------------------------------------------------
  // Connection Handlers
  // -------------------------------------------------------------------------
  
  const handlePortMouseDown = useCallback((e: React.MouseEvent, nodeId: string, port: 'output' | 'true' | 'false') => {
    if (readOnly) return;
    e.stopPropagation();
    
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    
    const portPos = getPortPosition(node, port);
    
    setConnectionDrag({
      isDragging: true,
      fromNodeId: nodeId,
      fromPort: port,
      currentX: portPos.x,
      currentY: portPos.y,
    });
  }, [nodes, readOnly]);
  
  const handlePortMouseUp = useCallback((e: React.MouseEvent, nodeId: string, port: 'input') => {
    if (readOnly) return;
    e.stopPropagation();
    
    if (!connectionDrag.isDragging || !connectionDrag.fromNodeId || !connectionDrag.fromPort) return;
    
    // Prevent connecting to self
    if (connectionDrag.fromNodeId === nodeId) return;
    
    // Prevent duplicate connections
    const existingConnection = connections.find(
      (c) => c.fromNodeId === connectionDrag.fromNodeId && c.toNodeId === nodeId
    );
    if (existingConnection) return;
    
    const newConnection: Connection = {
      id: generateId(),
      fromNodeId: connectionDrag.fromNodeId,
      toNodeId: nodeId,
      fromPort: connectionDrag.fromPort,
      toPort: port,
    };
    
    if (onAddConnection) {
      onAddConnection(newConnection);
    } else {
      setConnections((prev) => [...prev, newConnection]);
    }
  }, [connectionDrag, connections, setConnections, onAddConnection, readOnly]);

  // -------------------------------------------------------------------------
  // Node Management
  // -------------------------------------------------------------------------
  
  const addNode = useCallback((type: NodeType) => {
    if (readOnly) return;
    const newNode: WorkflowNode = {
      id: generateId(),
      type,
      x: 100 + Math.random() * 200,
      y: 150 + Math.random() * 200,
      label: NODE_TYPE_CONFIG[type].label,
      config: {},
    };
    
    if (type === 'delay') {
      newNode.config = { duration: 5, unit: 'minutes' };
    } else if (type === 'condition') {
      newNode.config = { condition: 'value > 0' };
    } else if (type === 'action') {
      newNode.config = { action: 'send_email' };
    }
    
    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newNode.id);
  }, [setNodes, setSelectedNodeId, readOnly]);
  
  const handleDeleteNode = useCallback((nodeId: string) => {
    if (readOnly) return;
    if (onDeleteNode) {
      onDeleteNode(nodeId);
    } else {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setConnections((prev) =>
        prev.filter((c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId)
      );
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
    }
  }, [onDeleteNode, setNodes, setConnections, setSelectedNodeId, selectedNodeId, readOnly]);
  
  const handleDeleteConnection = useCallback((connectionId: string) => {
    if (readOnly) return;
    if (onDeleteConnection) {
      onDeleteConnection(connectionId);
    } else {
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    }
  }, [onDeleteConnection, setConnections, readOnly]);
  
  const updateNodeConfig = useCallback((nodeId: string, key: string, value: any) => {
    if (readOnly) return;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? { ...n, config: { ...n.config, [key]: value } }
          : n
      )
    );
  }, [setNodes, readOnly]);
  
  const updateNodeLabel = useCallback((nodeId: string, label: string) => {
    if (readOnly) return;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId ? { ...n, label } : n
      )
    );
  }, [setNodes, readOnly]);

  // -------------------------------------------------------------------------
  // Save / Load
  // -------------------------------------------------------------------------
  
  const saveWorkflow = useCallback(() => {
    const workflow = {
      nodes,
      connections,
      version: '1.0',
      createdAt: new Date().toISOString(),
    };
    
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, connections]);
  
  const clearWorkflow = useCallback(() => {
    if (readOnly) return;
    if (confirm('Are you sure you want to clear the workflow?')) {
      setNodes([]);
      setConnections([]);
      setSelectedNodeId(null);
    }
  }, [setNodes, setConnections, setSelectedNodeId, readOnly]);

  // -------------------------------------------------------------------------
  // Render Helpers
  // -------------------------------------------------------------------------
  
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  
  const renderConnections = () => {
    return connections.map((conn) => {
      const fromNode = nodes.find((n) => n.id === conn.fromNodeId);
      const toNode = nodes.find((n) => n.id === conn.toNodeId);
      
      if (!fromNode || !toNode) return null;
      
      const fromPos = getPortPosition(fromNode, conn.fromPort);
      const toPos = getPortPosition(toNode, conn.toPort);
      
      return (
        <g key={conn.id} className="workflow-connection">
          <path
            d={createCurvedPath(fromPos.x, fromPos.y, toPos.x, toPos.y)}
            className="connection-line"
            onClick={() => handleDeleteConnection(conn.id)}
          />
          <circle
            cx={(fromPos.x + toPos.x) / 2}
            cy={(fromPos.y + toPos.y) / 2}
            r={6}
            className="connection-delete-btn"
            onClick={() => handleDeleteConnection(conn.id)}
          />
          <text
            x={(fromPos.x + toPos.x) / 2}
            y={(fromPos.y + toPos.y) / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="connection-delete-text"
            onClick={() => handleDeleteConnection(conn.id)}
          >
            ×
          </text>
        </g>
      );
    });
  };
  
  const renderTempConnection = () => {
    if (!connectionDrag.isDragging || !connectionDrag.fromNodeId || !connectionDrag.fromPort) return null;
    
    const fromNode = nodes.find((n) => n.id === connectionDrag.fromNodeId);
    if (!fromNode) return null;
    
    const fromPos = getPortPosition(fromNode, connectionDrag.fromPort);
    
    return (
      <path
        d={createCurvedPath(fromPos.x, fromPos.y, connectionDrag.currentX, connectionDrag.currentY)}
        className="connection-line temp-connection"
      />
    );
  };
  
  const renderPort = (node: WorkflowNode, port: string, _index: number, _total: number) => {
    const isOutput = port !== 'input';
    const isConditionPort = port === 'true' || port === 'false';
    
    let left = '50%';
    let top = isOutput ? '100%' : '0';
    let transform = isOutput ? 'translate(-50%, -50%)' : 'translate(-50%, -50%)';
    
    if (port === 'false') {
      left = '100%';
      top = '50%';
      transform = 'translate(-50%, -50%)';
    } else if (port === 'true') {
      left = '50%';
      top = '100%';
      transform = 'translate(-50%, -50%)';
    }
    
    return (
      <div
        key={port}
        className={`node-port ${port}`}
        style={{ left, top, transform }}
        onMouseDown={(e) => isOutput && handlePortMouseDown(e, node.id, port as 'output' | 'true' | 'false')}
        onMouseUp={(e) => !isOutput && handlePortMouseUp(e, node.id, 'input')}
        title={port}
      >
        {isConditionPort && <span className="port-label">{port}</span>}
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------
  
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (dragState.isDragging || connectionDrag.isDragging) {
        handleCanvasMouseUp();
      }
    };
    
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [dragState.isDragging, connectionDrag.isDragging, handleCanvasMouseUp]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  
  return (
    <div className="workflow-editor" style={{ height: '100%', width: '100%' }}>
      {/* Toolbar - only show in standalone mode */}
      {!onUpdateNodes && (
        <div className="workflow-toolbar">
          <div className="toolbar-section">
            <span className="toolbar-title">Workflow Editor</span>
          </div>
          
          <div className="toolbar-section">
            <button className="toolbar-btn" onClick={() => addNode('trigger')}>
              <span className="btn-icon">⚡</span>
              Trigger
            </button>
            <button className="toolbar-btn" onClick={() => addNode('action')}>
              <span className="btn-icon">⚙️</span>
              Action
            </button>
            <button className="toolbar-btn" onClick={() => addNode('condition')}>
              <span className="btn-icon">🔀</span>
              Condition
            </button>
            <button className="toolbar-btn" onClick={() => addNode('delay')}>
              <span className="btn-icon">⏱️</span>
              Delay
            </button>
          </div>
          
          <div className="toolbar-section">
            <button
              className={`toolbar-btn ${showGrid ? 'active' : ''}`}
              onClick={() => setShowGrid(!showGrid)}
            >
              <span className="btn-icon">⊞</span>
              Grid
            </button>
            <button
              className="toolbar-btn"
              onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
            >
              <span className="btn-icon">−</span>
            </button>
            <span className="zoom-level">{Math.round(scale * 100)}%</span>
            <button
              className="toolbar-btn"
              onClick={() => setScale((s) => Math.min(2, s + 0.1))}
            >
              <span className="btn-icon">+</span>
            </button>
          </div>
          
          <div className="toolbar-section" style={{ marginLeft: 'auto' }}>
            <button className="toolbar-btn" onClick={saveWorkflow}>
              <span className="btn-icon">💾</span>
              Save
            </button>
            <button
              className="toolbar-btn danger"
              onClick={clearWorkflow}
            >
              <span className="btn-icon">🗑️</span>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Main Canvas Area */}
      <div className="workflow-main" style={!onUpdateNodes ? undefined : { flex: 1 }}>
        {/* Canvas */}
        <div
          ref={canvasRef}
          className={`workflow-canvas ${showGrid ? 'show-grid' : ''}`}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onClick={() => setSelectedNodeId(null)}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {/* Connections SVG Layer */}
          <svg className="connections-layer">
            {renderConnections()}
            {renderTempConnection()}
          </svg>
          
          {/* Nodes */}
          {nodes.map((node) => {
            const config = NODE_TYPE_CONFIG[node.type];
            const isSelected = node.id === selectedNodeId;
            
            return (
              <div
                key={node.id}
                className={`workflow-node ${node.type} ${isSelected ? 'selected' : ''}`}
                style={{
                  left: node.x,
                  top: node.y,
                  width: NODE_WIDTH,
                  height: NODE_HEIGHT,
                }}
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="node-header" style={{ background: config.color }}>
                  <span className="node-icon">{config.icon}</span>
                  <span className="node-label">{node.label}</span>
                </div>
                <div className="node-body">
                  {node.config.condition && (
                    <div className="node-detail">{node.config.condition}</div>
                  )}
                  {node.config.duration && (
                    <div className="node-detail">
                      {node.config.duration} {node.config.unit}
                    </div>
                  )}
                  {node.config.actionType && (
                    <div className="node-detail">{node.config.actionType}</div>
                  )}
                </div>
                
                {/* Ports */}
                {config.ports.map((port, index) =>
                  renderPort(node, port, index, config.ports.length)
                )}
                
                {/* Delete Button */}
                <button
                  className="node-delete-btn"
                  onClick={() => handleDeleteNode(node.id)}
                  title="Delete node"
                >
                  ×
                </button>
              </div>
            );
          })}
          
          {/* Empty State */}
          {nodes.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <p>Click the buttons above to add nodes</p>
              <p className="empty-hint">or drag from the sidebar</p>
            </div>
          )}
        </div>
        
        {/* Properties Panel - only show in standalone mode */}
        {!onUpdateNodes && (
          <div className={`properties-panel ${selectedNode ? 'open' : ''}`}>
            <div className="panel-header">
              <h3>Properties</h3>
              <button
                className="close-panel-btn"
                onClick={() => setSelectedNodeId(null)}
              >
                ×
              </button>
            </div>
            
            <div className="panel-content">
              {selectedNode ? (
                <>
                  <div className="property-group">
                    <label>Label</label>
                    <input
                      type="text"
                      value={selectedNode.label}
                      onChange={(e) => updateNodeLabel(selectedNode.id, e.target.value)}
                      placeholder="Node label"
                    />
                  </div>
                  
                  <div className="property-group">
                    <label>Type</label>
                    <div className="property-value readonly">
                      {NODE_TYPE_CONFIG[selectedNode.type].label}
                    </div>
                  </div>
                  
                  <hr className="divider" />
                  
                  {/* Trigger Config */}
                  {selectedNode.type === 'trigger' && (
                    <div className="property-group">
                      <label>Trigger Type</label>
                      <select
                        value={selectedNode.config.triggerType || 'manual'}
                        onChange={(e) =>
                          updateNodeConfig(selectedNode.id, 'triggerType', e.target.value)
                        }
                      >
                        <option value="manual">Manual</option>
                        <option value="schedule">Schedule</option>
                        <option value="webhook">Webhook</option>
                      </select>
                      
                      {selectedNode.config.triggerType === 'schedule' && (
                        <>
                          <label style={{ marginTop: '12px' }}>Cron Expression</label>
                          <input
                            type="text"
                            value={selectedNode.config.schedule || ''}
                            onChange={(e) =>
                              updateNodeConfig(selectedNode.id, 'schedule', e.target.value)
                            }
                            placeholder="0 9 * * *"
                          />
                          <span className="help-text">e.g., 0 9 * * * for daily at 9am</span>
                        </>
                      )}
                    </div>
                  )}
                  
                  {/* Action Config */}
                  {selectedNode.type === 'action' && (
                    <div className="property-group">
                      <label>Action Type</label>
                      <select
                        value={selectedNode.config.actionType || 'send_email'}
                        onChange={(e) =>
                          updateNodeConfig(selectedNode.id, 'actionType', e.target.value)
                        }
                      >
                        <option value="send_email">Send Email</option>
                        <option value="call_api">Call API</option>
                        <option value="run_tool">Run Tool</option>
                      </select>
                    </div>
                  )}
                  
                  {/* Condition Config */}
                  {selectedNode.type === 'condition' && (
                    <div className="property-group">
                      <label>Condition</label>
                      <textarea
                        value={selectedNode.config.condition || ''}
                        onChange={(e) =>
                          updateNodeConfig(selectedNode.id, 'condition', e.target.value)
                        }
                        placeholder="e.g., value > 0"
                        rows={3}
                      />
                      <span className="help-text">
                        Use the 'true' and 'false' ports to branch the workflow
                      </span>
                    </div>
                  )}
                  
                  {/* Delay Config */}
                  {selectedNode.type === 'delay' && (
                    <div className="property-group">
                      <label>Duration</label>
                      <div className="property-row">
                        <div className="property-input-group">
                          <input
                            type="number"
                            min={1}
                            value={selectedNode.config.duration || 5}
                            onChange={(e) =>
                              updateNodeConfig(
                                selectedNode.id,
                                'duration',
                                parseInt(e.target.value) || 1
                              )
                            }
                          />
                        </div>
                        <select
                          value={selectedNode.config.unit || 'minutes'}
                          onChange={(e) =>
                            updateNodeConfig(selectedNode.id, 'unit', e.target.value)
                          }
                          style={{ width: '100px' }}
                        >
                          <option value="seconds">Seconds</option>
                          <option value="minutes">Minutes</option>
                          <option value="hours">Hours</option>
                          <option value="days">Days</option>
                        </select>
                      </div>
                    </div>
                  )}
                  
                  <hr className="divider" />
                  
                  <button
                    className="delete-node-btn"
                    onClick={() => handleDeleteNode(selectedNode.id)}
                  >
                    Delete Node
                  </button>
                </>
              ) : (
                <div className="panel-placeholder">
                  <div className="placeholder-icon">🖱️</div>
                  <p>Select a node to edit its properties</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Status Bar - only show in standalone mode */}
      {!onUpdateNodes && (
        <div className="workflow-statusbar">
          <span>{nodes.length} nodes</span>
          <span>{connections.length} connections</span>
          <span className="hint">Drag nodes to move • Click ports to connect</span>
        </div>
      )}
    </div>
  );
};

// Export types
export type { NodeType, WorkflowNode, Connection, WorkflowEditorProps };
