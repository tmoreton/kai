import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Plus, Trash2 } from "lucide-react";
import { settingsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { toast } from "../../components/Toast";

const ENV_EXAMPLES = [
  { key: 'ANTHROPIC_API_KEY', value: 'sk-ant-...', description: 'Claude API access' },
  { key: 'OPENAI_API_KEY', value: 'sk-...', description: 'OpenAI API access' },
  { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: 'ghp_...', description: 'GitHub MCP server' },
];

export function EnvSettings() {
  const { data } = useSuspenseQuery(settingsQueries.env());
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [showExamples, setShowExamples] = useState(false);

  const setMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => api.settings.setEnv(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      setNewKey("");
      setNewValue("");
      toast.success('Environment variable set');
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

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-kai-text">Environment Variables</h3>
        <p className="text-sm text-muted-foreground">Store API keys and configuration secrets</p>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Store API keys and configuration secrets</span>
        <button
          onClick={() => setShowExamples(!showExamples)}
          className="text-sm text-primary hover:underline"
        >
          {showExamples ? 'Hide examples' : 'Show examples'}
        </button>
      </div>

      {showExamples && (
        <div className="p-3 bg-kai-bg rounded-lg space-y-2">
          <p className="text-xs text-muted-foreground">Common examples (click to use):</p>
          {ENV_EXAMPLES.map((ex) => (
            <button
              key={ex.key}
              onClick={() => {
                setNewKey(ex.key);
                setNewValue(ex.value);
                setShowExamples(false);
              }}
              className="block w-full text-left px-2 py-1.5 text-sm hover:bg-accent/20 rounded"
            >
              <span className="font-mono text-primary">{ex.key}</span>
              <span className="text-muted-foreground ml-2">-- {ex.description}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="KEY"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className="px-3 py-2 bg-kai-bg border border-border rounded-lg text-sm font-mono"
        />
        <input
          type="text"
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="flex-1 px-3 py-2 bg-kai-bg border border-border rounded-lg text-sm font-mono"
        />
        <button
          onClick={() => setMutation.mutate({ key: newKey, value: newValue })}
          disabled={!newKey || setMutation.isPending}
          className="px-4 py-2 bg-kai-teal text-white rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-center justify-between p-2 bg-kai-bg rounded-lg">
            <div className="flex items-center gap-2 font-mono text-sm">
              <span className="text-primary font-medium">{key}</span>
              <span className="text-muted-foreground">=</span>
              <span className="text-muted-foreground">{value}</span>
            </div>
            <button
              onClick={() => removeMutation.mutate(key)}
              disabled={removeMutation.isPending}
              className="p-1.5 text-muted-foreground hover:text-destructive rounded hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="text-muted-foreground text-center py-8">
            <Key className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p>No environment variables set</p>
          </div>
        )}
      </div>
    </div>
  );
}
