import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Brain, UserCircle, Target, StickyNote } from "lucide-react";
import { settingsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { toast } from "../../components/Toast";
import { Button } from "../../components/ui/button";

export function SoulSettings() {
  const { data } = useSuspenseQuery(settingsQueries.soul());
  const queryClient = useQueryClient();

  // Parse soul content into sections
  const parseSoulContent = (content: string) => {
    const sections: Record<string, string> = {
      personality: '',
      goals: '',
      human: '',
      scratchpad: '',
    };

    const lines = content.split('\n');
    let currentSection = '';
    let currentContent: string[] = [];

    for (const line of lines) {
      const headerMatch = line.match(/^##?\s*(\w+)$/);
      if (headerMatch) {
        if (currentSection && currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = headerMatch[1].toLowerCase();
        currentContent = [];
      } else if (currentSection) {
        currentContent.push(line);
      }
    }

    if (currentSection && currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }

    return sections;
  };

  const buildSoulContent = (sections: Record<string, string>) => {
    const parts: string[] = [];
    if (sections.personality) parts.push(`## Personality\n${sections.personality}`);
    if (sections.goals) parts.push(`## Goals\n${sections.goals}`);
    if (sections.human) parts.push(`## Human\n${sections.human}`);
    if (sections.scratchpad) parts.push(`## Scratchpad\n${sections.scratchpad}`);
    return parts.join('\n\n');
  };

  const initialSections = parseSoulContent(data.content);
  const [sections, setSections] = useState(initialSections);

  const updateMutation = useMutation({
    mutationFn: (content: string) => api.settings.updateSoul(content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success('Soul identity saved');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to save';
      toast.error('Failed to save soul', message);
    },
  });

  const hasChanges = JSON.stringify(sections) !== JSON.stringify(initialSections);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Soul Identity
          </h2>
          <p className="text-sm text-muted-foreground">
            The AI's identity, personality, and knowledge about you
          </p>
        </div>
        <Button
          onClick={() => updateMutation.mutate(buildSoulContent(sections))}
          disabled={!hasChanges || updateMutation.isPending}
        >
          <Save className="w-4 h-4 mr-2" />
          {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Personality */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <UserCircle className="w-4 h-4" />
          Personality & Identity
        </label>
        <textarea
          value={sections.personality}
          onChange={(e) => setSections({ ...sections, personality: e.target.value })}
          className="w-full h-32 px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:border-primary outline-none"
          placeholder="Who is Kai? Describe their personality, tone, and approach..."
        />
        <p className="text-xs text-muted-foreground">
          How the AI behaves, speaks, and approaches tasks
        </p>
      </div>

      {/* Goals */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <Target className="w-4 h-4" />
          Goals
        </label>
        <textarea
          value={sections.goals}
          onChange={(e) => setSections({ ...sections, goals: e.target.value })}
          className="w-full h-32 px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:border-primary outline-none"
          placeholder="What is Kai trying to achieve?"
        />
        <p className="text-xs text-muted-foreground">
          The AI's objectives and what it's working toward
        </p>
      </div>

      {/* Human Context */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <UserCircle className="w-4 h-4" />
          About You (Human)
        </label>
        <textarea
          value={sections.human}
          onChange={(e) => setSections({ ...sections, human: e.target.value })}
          className="w-full h-32 px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:border-primary outline-none"
          placeholder="What should Kai know about you?"
        />
        <p className="text-xs text-muted-foreground">
          Information about the user - preferences, context, background
        </p>
      </div>

      {/* Scratchpad */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <StickyNote className="w-4 h-4" />
          Working Notes (Scratchpad)
        </label>
        <textarea
          value={sections.scratchpad}
          onChange={(e) => setSections({ ...sections, scratchpad: e.target.value })}
          className="w-full h-40 px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:border-primary outline-none"
          placeholder="Working notes, learnings, and context Kai should remember..."
        />
        <p className="text-xs text-muted-foreground">
          Persistent working memory - Kai can update this during conversations
        </p>
      </div>
    </div>
  );
}
