import { History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { cn } from '../../lib/utils';
import type { ExecutionLog, ExecutionStatus } from './types';

interface ExecutionLogsPanelProps {
  logs: ExecutionLog[];
  selectedLogId: string | null;
  onSelectLog: (id: string) => void;
}

export function ExecutionLogsPanel({ logs, selectedLogId, onSelectLog }: ExecutionLogsPanelProps) {
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
                      - {log.steps.length} steps
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
                        <p className="text-sm text-muted-foreground mt-1">{step.output}</p>
                        {step.error && <p className="text-sm text-destructive mt-1">{step.error}</p>}
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

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Status</p>
                    <p className="text-sm font-medium text-kai-text capitalize">{selectedLog.status}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Trigger</p>
                    <p className="text-sm font-medium text-kai-text capitalize">{selectedLog.triggerSource}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Steps</p>
                    <p className="text-sm font-medium text-kai-text">{selectedLog.steps.length}</p>
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
  size = 'sm',
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
