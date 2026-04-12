import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { settingsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { toast } from "../../components/Toast";

export function EnvSettings() {
  const { data } = useSuspenseQuery(settingsQueries.env());
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

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

  return (
    <div className="space-y-6">
      {/* All Environment Variables */}
      <div className="border-t pt-4">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
          <Key className="w-4 h-4" />
          All Environment Variables
        </h3>

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
