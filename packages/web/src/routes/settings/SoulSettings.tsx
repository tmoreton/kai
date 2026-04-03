import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { settingsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { toast } from "../../components/Toast";

export function SoulSettings() {
  const { data } = useSuspenseQuery(settingsQueries.soul());
  const queryClient = useQueryClient();
  const [content, setContent] = useState(data.content);

  const updateMutation = useMutation({
    mutationFn: api.settings.updateSoul,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success('Soul identity saved');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to save';
      toast.error('Failed to save soul', message);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-kai-text">Soul Identity</h3>
          <p className="text-sm text-muted-foreground">Edit the AI's identity, personality, and knowledge about you</p>
        </div>
        <button
          onClick={() => updateMutation.mutate(content)}
          disabled={updateMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full h-96 px-3 py-2 bg-kai-bg border border-border rounded-lg text-sm font-mono resize-none focus:border-primary outline-none"
        placeholder="# Soul Identity..."
      />
    </div>
  );
}
