import { useState, useEffect } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Brain, Target, StickyNote, UserCircle, FileText } from "lucide-react";
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
  
  // Fetch both soul and context data
  const soulQuery = useSuspenseQuery(settingsQueries.soul());
  const contextQuery = useSuspenseQuery(settingsQueries.context());
  
  const soulData = soulQuery.data;
  const contextData = contextQuery.data;
  
  // Parse initial soul sections
  const initialSections = parseSoulContent(soulData.content);
  const [soulSections, setSoulSections] = useState(initialSections);
  
  // Context state
  const [contextContent, setContextContent] = useState(contextData.content);
  const [contextScope, setContextScope] = useState<"global" | "project">(
    contextData.isProject ? "project" : "global"
  );
  
  // Track if data has changed
  const soulChanged = JSON.stringify(soulSections) !== JSON.stringify(initialSections);
  const contextChanged = contextContent !== contextData.content;
  const hasChanges = soulChanged || contextChanged;
  
  // Update states when data changes
  useEffect(() => {
    setSoulSections(parseSoulContent(soulData.content));
  }, [soulData.content]);
  
  useEffect(() => {
    setContextContent(contextData.content);
    setContextScope(contextData.isProject ? "project" : "global");
  }, [contextData.content, contextData.isProject]);

  // Mutations
  const soulMutation = useMutation({
    mutationFn: (content: string) => api.settings.updateSoul(content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success("Soul identity saved");
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Failed to save";
      toast.error("Failed to save soul", message);
    },
  });

  const contextMutation = useMutation({
    mutationFn: ({ content, scope }: { content: string; scope: "global" | "project" }) =>
      api.settings.updateContext(content, scope),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success("Context saved", `Saved to ${contextScope} context`);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Failed to save";
      toast.error("Failed to save context", message);
    },
  });

  const handleSave = () => {
    if (soulChanged) {
      soulMutation.mutate(buildSoulContent(soulSections));
    }
    if (contextChanged) {
      contextMutation.mutate({ content: contextContent, scope: contextScope });
    }
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
          disabled={!hasChanges || soulMutation.isPending || contextMutation.isPending}
        >
          <Save className="w-4 h-4 mr-2" />
          {soulMutation.isPending || contextMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {/* Soul Identity Section */}
      <div className="space-y-6">
        <h3 className="font-medium text-foreground flex items-center gap-2">
          <Brain className="w-4 h-4 text-kai-teal" />
          Soul Identity
          <span className="text-xs text-muted-foreground font-normal ml-2">{soulData.path}</span>
        </h3>

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
            value={soulSections.human}
            onChange={(e) => setSoulSections({ ...soulSections, human: e.target.value })}
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
            value={soulSections.scratchpad}
            onChange={(e) => setSoulSections({ ...soulSections, scratchpad: e.target.value })}
            className="w-full h-40 px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:border-primary outline-none"
            placeholder="Working notes, learnings, and context Kai should remember..."
          />
          <p className="text-xs text-muted-foreground">
            Persistent working memory - Kai can update this during conversations
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Context Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-foreground flex items-center gap-2">
            <FileText className="w-4 h-4 text-kai-teal" />
            Context
            <span className="text-xs text-muted-foreground font-normal ml-2">
              {contextScope === "project" && contextData.projectPath
                ? contextData.projectPath
                : contextData.globalPath}
            </span>
          </h3>
          {contextData.hasProjectContext && (
            <select
              value={contextScope}
              onChange={(e) => setContextScope(e.target.value as "global" | "project")}
              className="px-3 py-1.5 bg-card border border-border rounded-md text-sm"
            >
              <option value="global">Global</option>
              <option value="project">Project</option>
            </select>
          )}
        </div>

        <textarea
          value={contextContent}
          onChange={(e) => setContextContent(e.target.value)}
          className="w-full h-64 px-3 py-2 bg-card border border-border rounded-lg text-sm font-mono resize-none focus:border-primary outline-none"
          placeholder="# Context goals, project info, or any relevant details..."
        />
        <p className="text-xs text-muted-foreground">
          Project-specific context and goals. Use global for universal context, project for specific codebase details.
        </p>
      </div>
    </div>
  );
}
