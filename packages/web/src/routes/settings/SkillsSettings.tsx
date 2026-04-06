import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Puzzle, RotateCcw, Trash2, Plus, Code2, Check, X, Download, 
  ChevronDown, ChevronUp, Package
} from "lucide-react";
import { settingsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { cn } from "../../lib/utils";
import { toast } from "../../components/Toast";
import type { Skill } from "../../types/api";
import { Button } from "../../components/ui/button";

// Built-in skill registry from kai-skills — all skills are external
const BUILTIN_SKILLS = [
  {
    id: "git",
    name: "Git",
    description: "Git operations — smart commits, PR workflows, branch management",
    author: "Kai",
    tags: ["version-control", "git", "github"],
  },
  {
    id: "docker",
    name: "Docker",
    description: "Docker containers — build images, run containers, compose operations",
    author: "Kai",
    tags: ["docker", "containers", "devops"],
  },
  {
    id: "browser",
    name: "Browser",
    description: "Web automation — navigate pages, click elements, fill forms, screenshots",
    author: "Kai",
    tags: ["browser", "web", "playwright"],
  },
  {
    id: "email",
    name: "Email",
    description: "Email via SMTP/IMAP — send and read with Gmail, Outlook, custom servers",
    author: "Kai",
    tags: ["email", "smtp", "communication"],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Notion workspace — query databases, create pages, manage content",
    author: "Kai",
    tags: ["notion", "wiki", "notes"],
  },
  {
    id: "database",
    name: "Database",
    description: "Database operations — migrations, queries, schema inspection",
    author: "Kai",
    tags: ["database", "sql", "migrations"],
  },
  {
    id: "twitter",
    name: "Twitter/X",
    description: "Twitter/X API — search tweets, analyze users, post content",
    author: "Kai",
    tags: ["twitter", "x", "social-media"],
  },
  {
    id: "youtube",
    name: "YouTube Analytics",
    description: "YouTube Data API — channel stats, video metrics, analytics",
    author: "Kai",
    tags: ["youtube", "analytics", "video"],
  },
  {
    id: "data-storage",
    name: "Data Storage",
    description: "File I/O — read/write JSON, Markdown, and text files",
    author: "Kai",
    tags: ["data", "files", "json", "storage"],
  },
  {
    id: "web-tools",
    name: "Web Tools",
    description: "Web utilities — fetch pages, search via Tavily",
    author: "Kai",
    tags: ["web", "fetch", "search"],
  },
  {
    id: "instagram",
    name: "Instagram",
    description: "Instagram API — user profiles, media posts, hashtag search, insights",
    author: "Kai",
    tags: ["instagram", "social-media", "photos"],
  },
  {
    id: "facebook",
    name: "Facebook",
    description: "Facebook Pages API — page info, posts, insights, publishing",
    author: "Kai",
    tags: ["facebook", "social-media", "pages"],
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    description: "LinkedIn API — profile info, create posts, analytics, people search",
    author: "Kai",
    tags: ["linkedin", "social-media", "professional"],
  },
  {
    id: "tiktok",
    name: "TikTok",
    description: "TikTok API — user info, videos, stats, hashtag search",
    author: "Kai",
    tags: ["tiktok", "social-media", "video"],
  },
  {
    id: "threads",
    name: "Threads",
    description: "Threads API — profile, posts, publishing, replies, insights",
    author: "Kai",
    tags: ["threads", "social-media", "meta"],
  },
  {
    id: "bluesky",
    name: "Bluesky",
    description: "Bluesky AT Protocol — profile, feed, posting, search, social actions",
    author: "Kai",
    tags: ["bluesky", "social-media", "at-protocol"],
  },
];

const SKILL_EXAMPLES = [
  'github:tmoreton/kai-skill-example',
  'npm:@kai-tools/skill-example',
];

export function SkillsSettings() {
  const { data: settings } = useSuspenseQuery(settingsQueries.list());
  const queryClient = useQueryClient();
  const [installSource, setInstallSource] = useState("");
  const [showExamples, setShowExamples] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillCode, setSkillCode] = useState(`// Define your skill tools here
// Example: A simple greeting tool

export const tools = {
  greet: async ({ name }: { name: string }) => {
    return { message: \`Hello, \${name}!\` };
  },
};

export const description = "A simple greeting skill";
export const version = "1.0.0";`);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  const installMutation = useMutation({
    mutationFn: api.settings.installSkill,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      queryClient.refetchQueries({ queryKey: settingsQueries.all(), type: 'active' });
      setInstallSource("");
      toast.success('Skill installed', result.id || 'Successfully installed');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to install skill';
      toast.error('Installation failed', message, 8000);
    },
  });

  const reloadMutation = useMutation({
    mutationFn: api.settings.reloadSkills,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      if (result.errors.length > 0) {
        toast.warning('Skills reloaded', `${result.loaded} loaded, ${result.errors.length} errors`);
      } else {
        toast.success('Skills reloaded', `${result.loaded} skills loaded successfully`);
      }
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to reload skills';
      toast.error('Reload failed', message);
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: api.settings.uninstallSkill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success('Skill uninstalled');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to uninstall skill';
      toast.error('Uninstall failed', message);
    },
  });

  const createMutation = useMutation({
    mutationFn: ({ name, description, code }: { name: string; description: string; code: string }) => 
      api.settings.createCustomSkill(name, description, code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      setShowCreateForm(false);
      setSkillName("");
      setSkillDescription("");
      toast.success('Skill created', 'Custom skill created successfully');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to create skill';
      toast.error('Creation failed', message, 8000);
    },
  });

  const handleCreateSkill = () => {
    if (!skillName.trim()) {
      toast.error('Name required', 'Please enter a skill name');
      return;
    }
    createMutation.mutate({ name: skillName, description: skillDescription, code: skillCode });
  };

  // Get installed skill IDs for quick lookup
  const installedSkillIds = new Set(settings.skills.map((s: Skill) => s.id));

  // Available built-in skills (not installed)
  const availableBuiltinSkills = BUILTIN_SKILLS.filter(s => !installedSkillIds.has(s.id));

  const installBuiltinSkill = (skillId: string) => {
    // Use shorthand format: kai:skill-id
    installMutation.mutate(`kai:${skillId}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-kai-text">Skills</h3>
          <p className="text-sm text-muted-foreground">
            {settings.skills.length} installed · Manage and discover new capabilities
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreateForm(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Custom
          </Button>
          <button
            onClick={() => reloadMutation.mutate()}
            disabled={reloadMutation.isPending}
            className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-accent/10"
          >
            <RotateCcw className={cn("w-4 h-4", reloadMutation.isPending && "animate-spin")} />
            Reload
          </button>
        </div>
      </div>

      {/* Available Built-in Skills */}
      {availableBuiltinSkills.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            <h4 className="font-medium text-sm">Available Skills</h4>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {availableBuiltinSkills.length}
            </span>
          </div>
          
          <div className="grid gap-3">
            {availableBuiltinSkills.map((skill) => (
              <div 
                key={skill.id}
                className="p-4 bg-card border border-border rounded-lg hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-kai-text">{skill.name}</span>
                      <span className="text-xs text-muted-foreground">by {skill.author}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{skill.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {skill.tags.map(tag => (
                        <span 
                          key={tag} 
                          className="text-xs bg-accent/20 text-accent-foreground px-1.5 py-0.5 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => installBuiltinSkill(skill.id)}
                      disabled={installMutation.isPending}
                    >
                      {installMutation.isPending ? (
                        <RotateCcw className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Download className="w-4 h-4 mr-2" />
                          Install
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Custom Skill Form */}
      {showCreateForm && (
        <div className="p-4 bg-kai-bg rounded-lg border border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Code2 className="w-5 h-5 text-primary" />
              <h4 className="font-medium">Create Custom Skill</h4>
            </div>
            <button
              onClick={() => setShowCreateForm(false)}
              className="p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Skill Name</label>
                <input
                  type="text"
                  placeholder="my-custom-skill"
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <input
                  type="text"
                  placeholder="What does this skill do?"
                  value={skillDescription}
                  onChange={(e) => setSkillDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm"
                />
              </div>
            </div>
            
            <div>
              <label className="text-sm font-medium mb-1 block">Skill Code (TypeScript)</label>
              <textarea
                value={skillCode}
                onChange={(e) => setSkillCode(e.target.value)}
                className="w-full h-64 px-3 py-2 bg-card border border-border rounded-lg text-sm font-mono text-xs"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Define your tools in the <code className="bg-muted px-1 rounded">tools</code> object. Each tool is an async function that receives parameters and returns a result.
              </p>
            </div>
            
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreateSkill}
                disabled={createMutation.isPending || !skillName.trim()}
              >
                {createMutation.isPending ? (
                  <>
                    <RotateCcw className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Create Skill
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Install from Source */}
      <div className="p-3 bg-kai-bg rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">Install from GitHub or npm</span>
          <button
            onClick={() => setShowExamples(!showExamples)}
            className="text-sm text-primary hover:underline"
          >
            {showExamples ? 'Hide examples' : 'Show examples'}
          </button>
        </div>

        {showExamples && (
          <div className="mb-3 space-y-1">
            <p className="text-xs text-muted-foreground mb-2">Click to use:</p>
            {SKILL_EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setInstallSource(ex)}
                className="block w-full text-left px-2 py-1.5 text-sm text-muted-foreground hover:text-kai-text hover:bg-accent/20 rounded"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="GitHub repo or npm package..."
            value={installSource}
            onChange={(e) => setInstallSource(e.target.value)}
            className="flex-1 px-3 py-2 bg-card border border-border rounded-lg text-sm"
          />
          <button
            onClick={() => installMutation.mutate(installSource)}
            disabled={!installSource || installMutation.isPending}
            className="px-4 py-2 bg-kai-teal text-white rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {installMutation.isPending ? 'Installing...' : 'Install'}
          </button>
        </div>
      </div>

      {/* Installed Skills */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4 text-green-500" />
          <h4 className="font-medium text-sm">Installed Skills</h4>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {settings.skills.length}
          </span>
        </div>

        <div className="space-y-2">
          {settings.skills.map((skill: Skill) => (
            <div 
              key={skill.id} 
              className={cn(
                "p-4 rounded-lg border",
                skill.missingConfig && skill.missingConfig.length > 0
                  ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                  : "bg-kai-bg border-border"
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-kai-text">{skill.name}</span>
                    <span className="text-xs text-muted-foreground">v{skill.version}</span>
                    <span className="text-xs text-muted-foreground">by {skill.author}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{skill.description}</p>
                  
                  {/* Missing config warning */}
                  {skill.missingConfig && skill.missingConfig.length > 0 && (
                    <div className="mt-3 p-3 bg-red-100 dark:bg-red-900/30 rounded border border-red-200 dark:border-red-800">
                      <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-sm font-medium">
                        <span>⚠️</span>
                        <span>Configuration Required</span>
                      </div>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                        Add these environment variables in <strong>Environment</strong> settings:
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {skill.missingConfig.map((envKey) => (
                          <code 
                            key={envKey}
                            className="px-2 py-1 text-xs bg-white dark:bg-red-950 border border-red-200 dark:border-red-700 rounded font-mono text-red-700 dark:text-red-300"
                          >
                            {envKey}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Tools list */}
                  {skill.tools.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          {skill.tools.length} {skill.tools.length === 1 ? 'tool' : 'tools'} available
                        </span>
                        <button
                          onClick={() => setExpandedSkill(expandedSkill === skill.id ? null : skill.id)}
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          {expandedSkill === skill.id ? (
                            <>
                              <ChevronUp className="w-3 h-3" />
                              Hide details
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3 h-3" />
                              Show details
                            </>
                          )}
                        </button>
                      </div>
                      
                      {expandedSkill === skill.id && (
                        <div className="border border-border rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50 border-b border-border">
                              <tr>
                                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-32">Tool Name</th>
                                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Description</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {skill.tools.map((tool) => (
                                <tr key={tool.name} className="hover:bg-accent/5">
                                  <td className="px-3 py-2">
                                    <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">
                                      {tool.name}
                                    </code>
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground text-xs">
                                    {tool.description}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => uninstallMutation.mutate(skill.id)}
                  disabled={uninstallMutation.isPending}
                  className="p-2 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10 disabled:opacity-50"
                  title="Uninstall skill"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          
          {settings.skills.length === 0 && (
            <div className="text-muted-foreground text-center py-8">
              <Puzzle className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p>No skills installed</p>
              <p className="text-sm text-muted-foreground mt-1">
                Install skills from the available list above to add new capabilities
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
