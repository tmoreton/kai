import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { settingsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { toast } from "../../components/Toast";

export function ContextSettings() {
  const { data } = useSuspenseQuery(settingsQueries.context());
  const queryClient = useQueryClient();
  const [content, setContent] = useState(data.content);
  const [scope, setScope] = useState<'global' | 'project'>(data.isProject ? 'project' : 'global');

  const updateMutation = useMutation({
    mutationFn: () => api.settings.updateContext(content, scope),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success('Context saved', `Saved to ${scope} context`);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to save';
      toast.error('Failed to save context', message);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-kai-text">Context (Goals/Scratchpad)</h3>
          <p className="text-sm text-muted-foreground">
            Global: {data.globalPath}
            {data.hasProjectContext && <span className="block mt-1">Project: {data.projectPath}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.hasProjectContext && (
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'global' | 'project')}
              className="px-3 py-2 bg-kai-bg border border-border rounded-lg text-sm"
            >
              <option value="global">Global</option>
              <option value="project">Project</option>
            </select>
          )}
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full h-96 px-3 py-2 bg-kai-bg border border-border rounded-lg text-sm font-mono resize-none focus:border-primary outline-none"
        placeholder="# Context..."
      />
    </div>
  );
}
