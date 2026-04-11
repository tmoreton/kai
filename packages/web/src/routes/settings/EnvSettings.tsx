import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Plus, Trash2, Mail, Info, Eye, EyeOff, ExternalLink } from "lucide-react";
import { settingsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { toast } from "../../components/Toast";

const EMAIL_ENV_VARS = [
  { key: 'NOTIFICATION_EMAIL', description: 'Your email address to receive agent notifications' },
  { key: 'SMTP_HOST', description: 'SMTP server host (e.g., smtp.gmail.com)' },
  { key: 'SMTP_PORT', description: 'SMTP port (usually 587 or 465)' },
  { key: 'SMTP_USER', description: 'SMTP username/email' },
  { key: 'SMTP_PASS', description: 'SMTP password or app-specific password' },
  { key: 'SMTP_FROM', description: 'Sender name (optional, default: Kai)' },
];

export function EnvSettings() {
  const { data } = useSuspenseQuery(settingsQueries.env());
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [showEmailHelp, setShowEmailHelp] = useState(false);

  const setMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      await api.settings.setEnv(key, value);
      // Reload provider if API key changed - wait for it to complete
      if (key === 'OPENROUTER_API_KEY' || key === 'FIREWORKS_API_KEY') {
        try {
          await api.settings.reloadProvider();
          // Small delay to ensure provider is fully ready
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error('Failed to reload provider:', e);
        }
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      setNewKey("");
      setNewValue("");
      if (vars.key === 'OPENROUTER_API_KEY' || vars.key === 'FIREWORKS_API_KEY') {
        toast.success('API key saved', 'Provider reloaded - ready to use!');
      } else {
        toast.success('Environment variable set');
      }
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to set variable';
      toast.error('Failed to set variable', message);
    },
  });

  const removeMutation = useMutation({
    mutationFn: api.settings.removeEnv,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success('Environment variable removed');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to remove variable';
      toast.error('Failed to remove variable', message);
    },
  });

  const entries = Object.entries(data.env);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});

  // Check configuration status
  const hasOpenRouterKey = entries.some(([k]) => k === 'OPENROUTER_API_KEY');
  const hasEmailConfigured = entries.some(([k]) => k === 'NOTIFICATION_EMAIL');

  const API_KEY_EXAMPLES = [
    { 
      key: 'OPENROUTER_API_KEY', 
      value: 'sk-or-...', 
      description: 'Required - Get at openrouter.ai/keys',
      link: 'https://openrouter.ai/keys'
    },
    { 
      key: 'TAVILY_API_KEY', 
      value: 'tvly-...', 
      description: 'Optional - Enables web search',
      link: 'https://tavily.com'
    },
    { 
      key: 'GITHUB_PERSONAL_ACCESS_TOKEN', 
      value: 'ghp_...', 
      description: 'Optional - GitHub MCP server',
    },
  ];

  return (
    <div className="space-y-6">
      {/* API Key Section */}
      <div className="space-y-4">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Key className="w-4 h-4" />
          API Key
        </h3>

        <div className={`p-4 rounded-lg border ${hasOpenRouterKey ? 'bg-teal-50 border-teal-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-start gap-3">
            {hasOpenRouterKey ? (
              <div className="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                <Key className="w-3 h-3 text-teal-600" />
              </div>
            ) : (
              <Key className="w-5 h-5 text-red-500 flex-shrink-0" />
            )}
            <div className="flex-1">
              <div className="font-medium text-sm mb-1">
                {hasOpenRouterKey ? 'OpenRouter Connected' : 'OpenRouter API Key Required'}
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                {hasOpenRouterKey 
                  ? 'Kimi K2.5 is ready to use.' 
                  : 'Kai requires an OpenRouter API key to function. Get one at openrouter.ai'}
              </p>
              {!hasOpenRouterKey && (
                <a 
                  href="https://openrouter.ai/keys" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                >
                  Get API Key <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Email Setup Section */}
      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Email Notifications
          </h3>
          <button
            onClick={() => setShowEmailHelp(!showEmailHelp)}
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            <Info className="w-3 h-3" />
            {showEmailHelp ? 'Hide setup guide' : 'How to setup'}
          </button>
        </div>
        
        {showEmailHelp && (
          <div className="p-4 bg-muted/50 rounded-lg space-y-3 text-sm">
            <p className="text-muted-foreground">
              To receive email notifications when agents complete, add these environment variables:
            </p>
            <div className="space-y-2">
              {EMAIL_ENV_VARS.map((v) => (
                <div key={v.key} className="flex items-start gap-2">
                  <code className="px-1.5 py-0.5 bg-background rounded text-xs font-mono text-primary">
                    {v.key}
                  </code>
                  <span className="text-muted-foreground text-xs">{v.description}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Tip: For Gmail, use an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">App Password</a> instead of your regular password.
            </p>
          </div>
        )}

        {!hasEmailConfigured && !showEmailHelp && (
          <p className="text-sm text-muted-foreground">
            Email notifications are not configured. 
            <button onClick={() => setShowEmailHelp(true)} className="text-primary hover:underline ml-1">
              Learn how to set up
            </button>
          </p>
        )}
      </div>

      {/* All Environment Variables */}
      <div className="border-t pt-4">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
          <Key className="w-4 h-4" />
          All Environment Variables
        </h3>

        {/* Quick Add Examples */}
        <div className="p-3 bg-muted rounded-lg space-y-2 mb-4">
          <p className="text-xs text-muted-foreground">Quick add (click to use):</p>
          {API_KEY_EXAMPLES.map((ex) => (
            <button
              key={ex.key}
              onClick={() => {
                setNewKey(ex.key);
                setNewValue(ex.value);
              }}
              className="block w-full text-left px-2 py-1.5 text-sm hover:bg-accent/20 rounded"
            >
              <span className="font-mono text-primary">{ex.key}</span>
              <span className="text-muted-foreground ml-2">-- {ex.description}</span>
              {ex.link && <ExternalLink className="w-3 h-3 inline ml-1 text-muted-foreground" />}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="KEY"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono"
          />
          <input
            type="text"
            placeholder="value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono"
          />
          <button
            onClick={() => setMutation.mutate({ key: newKey, value: newValue })}
            disabled={!newKey || setMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1 mt-4">
          {entries.map(([key, value]) => {
            const isSecret = key.toLowerCase().includes('key') || key.toLowerCase().includes('pass') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('token');
            const isVisible = visibleSecrets[key];
            const displayValue = isSecret && !isVisible 
              ? '•'.repeat(Math.min(value.length, 20)) 
              : value;
            
            return (
              <div key={key} className="flex items-center justify-between p-2 bg-muted rounded-lg min-w-0">
                <div className="flex items-center gap-2 font-mono text-sm min-w-0 flex-1">
                  <span className="text-primary font-medium shrink-0">{key}</span>
                  <span className="text-muted-foreground shrink-0">=</span>
                  <span className="text-muted-foreground truncate">{displayValue}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isSecret && (
                    <button
                      onClick={() => setVisibleSecrets(prev => ({ ...prev, [key]: !prev[key] }))}
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded hover:bg-accent/20"
                      title={isVisible ? "Hide" : "Show"}
                    >
                      {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={() => removeMutation.mutate(key)}
                    disabled={removeMutation.isPending}
                    className="p-1.5 text-muted-foreground hover:text-destructive rounded hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
          {entries.length === 0 && (
            <div className="text-muted-foreground text-center py-8">
              <Key className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p>No environment variables set</p>
              <p className="text-xs mt-1">Add your OPENROUTER_API_KEY to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
