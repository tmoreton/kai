import { Input } from '../../components/ui/input';
import { TRIGGER_TYPES, ACTION_TYPES } from './constants';
import type { NodeConfig, TriggerType, ActionType } from './types';

interface ConfigProps {
  config: NodeConfig;
  onChange: (config: Partial<NodeConfig>) => void;
}

export function TriggerConfig({ config, onChange }: ConfigProps) {
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
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {TRIGGER_TYPES.find((t) => t.value === config.triggerType)?.description}
        </p>
      </div>

      {config.triggerType === 'schedule' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cron Schedule</label>
          <Input value={config.schedule || ''} onChange={(e) => onChange({ schedule: e.target.value })} placeholder="0 9 * * *" />
          <p className="text-xs text-muted-foreground">Cron expression (e.g., 0 9 * * * for daily at 9am)</p>
        </div>
      )}

      {config.triggerType === 'webhook' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Webhook URL</label>
          <Input value={config.webhookUrl || ''} onChange={(e) => onChange({ webhookUrl: e.target.value })} placeholder="/webhooks/my-workflow" />
        </div>
      )}

      {config.triggerType === 'event' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Event Name</label>
          <Input value={config.eventName || ''} onChange={(e) => onChange({ eventName: e.target.value })} placeholder="user.created" />
        </div>
      )}
    </div>
  );
}

export function ActionConfig({ config, onChange }: ConfigProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Action Type</label>
        <select
          value={config.actionType || 'run_tool'}
          onChange={(e) => onChange({ actionType: e.target.value as ActionType })}
          className="w-full h-9 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-1 focus:ring-kai-teal"
        >
          {ACTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {config.actionType === 'run_tool' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tool Name</label>
          <Input value={config.toolName || ''} onChange={(e) => onChange({ toolName: e.target.value })} placeholder="e.g., fetch_data, process_csv" />
        </div>
      )}

      {config.actionType === 'call_api' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">API Endpoint</label>
          <Input value={config.apiEndpoint || ''} onChange={(e) => onChange({ apiEndpoint: e.target.value })} placeholder="https://api.example.com/data" />
        </div>
      )}

      {config.actionType === 'send_email' && (
        <>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
            <Input value={config.emailTo || ''} onChange={(e) => onChange({ emailTo: e.target.value })} placeholder="recipient@example.com" />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</label>
            <Input value={config.emailSubject || ''} onChange={(e) => onChange({ emailSubject: e.target.value })} placeholder="Email subject" />
          </div>
        </>
      )}

      {config.actionType === 'execute_code' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Code</label>
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

export function ConditionConfig({ config, onChange }: ConfigProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Condition Expression</label>
        <Input value={config.condition || ''} onChange={(e) => onChange({ condition: e.target.value })} placeholder="value > 0" />
        <p className="text-xs text-muted-foreground">JavaScript expression that evaluates to true or false</p>
      </div>
      <div className="p-3 bg-accent/10 rounded-lg">
        <p className="text-xs text-muted-foreground"><strong>True</strong> branch executes if condition is true</p>
        <p className="text-xs text-muted-foreground mt-1"><strong>False</strong> branch executes if condition is false</p>
      </div>
    </div>
  );
}

export function DelayConfig({ config, onChange }: ConfigProps) {
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1 space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Duration</label>
          <Input type="number" min={1} value={config.duration || 5} onChange={(e) => onChange({ duration: parseInt(e.target.value) || 1 })} />
        </div>
        <div className="w-28 space-y-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Unit</label>
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
