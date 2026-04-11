import { useState, useEffect } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Brain, Target, StickyNote, UserCircle, Info } from "lucide-react";
import { settingsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { toast } from "../../components/Toast";
import { Button } from "../../components/ui/button";

// Parse soul content (expects ## Section headers)
function parseSoulContent(content: string): Record<string, string> {
  const sections: Record<string, string> = {
    personality: "",
    goals: "",
    human: "",
    scratchpad: "",
  };

  const lines = content.split("\n");
  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^##?\s*(\w+)$/);
    if (headerMatch) {
      if (currentSection && currentContent.length > 0) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = headerMatch[1].toLowerCase();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  if (currentSection && currentContent.length > 0) {
    sections[currentSection] = currentContent.join("\n").trim();
  }

  return sections;
}

// Build soul content from sections
function buildSoulContent(sections: Record<string, string>): string {
  const parts: string[] = [];
  if (sections.personality) parts.push(`## Personality\n${sections.personality}`);
  if (sections.goals) parts.push(`## Goals\n${sections.goals}`);
  if (sections.human) parts.push(`## Human\n${sections.human}`);
  if (sections.scratchpad) parts.push(`## Scratchpad\n${sections.scratchpad}`);
  return parts.join("\n\n");
}

export function MemorySettings() {
  const queryClient = useQueryClient();
  
  const { data: soulData } = useSuspenseQuery(settingsQueries.soul());
  
  // Parse initial soul sections
  const initialSections = parseSoulContent(soulData.content);
  const [soulSections, setSoulSections] = useState(initialSections);
  
  // Track if data has changed
  const hasChanges = JSON.stringify(soulSections) !== JSON.stringify(initialSections);
  
  // Update state when data changes
  useEffect(() => {
    setSoulSections(parseSoulContent(soulData.content));
  }, [soulData.content]);

  const soulMutation = useMutation({
    mutationFn: (content: string) => api.settings.updateSoul(content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success("Memory saved");
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Failed to save";
      toast.error("Failed to save memory", message);
    },
  });

  const handleSave = () => {
    soulMutation.mutate(buildSoulContent(soulSections));
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Memory
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure AI identity, goals, and working context
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || soulMutation.isPending}
        >
          <Save className="w-4 h-4 mr-2" />
          {soulMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
        <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
        <p className="text-blue-700">
          All content is saved to <code className="font-mono text-xs bg-blue-100 px-1 py-0.5 rounded">{soulData.path}</code>. 
          This replaces the old context JSON files with simple plain text sections.
        </p>
      </div>

      {/* Personality */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <UserCircle className="w-4 h-4" />
          Personality & Identity
        </label>
        <textarea
          value={soulSections.personality}
          onChange={(e) => setSoulSections({ ...soulSections, personality: e.target.value })}
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
          value={soulSections.goals}
          onChange={(e) => setSoulSections({ ...soulSections, goals: e.target.value })}
          className="w-full h-40 px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:border-primary outline-none"
          placeholder="What is Kai trying to achieve? List objectives, targets, and success metrics..."
        />
        <p className="text-xs text-muted-foreground">
          Strategic objectives, KPIs, and what the AI is working toward
        </p>
      </div>

      {/* Human Context */}
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <UserCircle className="w-4 h-4" />
          About You (Human)
        </label>
        <textarea
          value={soulSections.human}
          onChange={(e) => setSoulSections({ ...soulSections, human: e.target.value })}
          className="w-full h-32 px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:border-primary outline-none"
          placeholder="What should Kai know about you? Preferences, background, role..."
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
          value={soulSections.scratchpad}
          onChange={(e) => setSoulSections({ ...soulSections, scratchpad: e.target.value })}
          className="w-full h-64 px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:border-primary outline-none"
          placeholder="Working notes, learnings, project details, and context Kai should remember..."
        />
        <p className="text-xs text-muted-foreground">
          Persistent working memory - project details, strategy notes, recent decisions
        </p>
      </div>
    </div>
  );
}
