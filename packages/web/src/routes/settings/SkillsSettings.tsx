import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Puzzle, RotateCcw, Trash2, Plus, Code2, Check, X } from "lucide-react";
import { settingsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { cn } from "../../lib/utils";
import { toast } from "../../components/Toast";
import type { Skill } from "../../types/api";
import { Button } from "../../components/ui/button";

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

  const installMutation = useMutation({
    mutationFn: api.settings.installSkill,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-kai-text">Installed Skills</h3>
          <p className="text-sm text-muted-foreground">Skills add custom tools and capabilities</p>
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

      <div className="space-y-2">
        {settings.skills.map((skill: Skill) => (
          <div key={skill.id} className="flex items-center justify-between p-3 bg-kai-bg rounded-lg">
            <div>
              <div className="font-medium text-kai-text">{skill.name}</div>
              <div className="text-sm text-muted-foreground">{skill.description}</div>
              <div className="text-xs text-muted-foreground mt-1">
                v{skill.version} - {skill.tools.length} tools - {skill.path}
              </div>
            </div>
            <button
              onClick={() => uninstallMutation.mutate(skill.id)}
              disabled={uninstallMutation.isPending}
              className="p-2 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {settings.skills.length === 0 && (
          <div className="text-muted-foreground text-center py-8">
            <Puzzle className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p>No skills installed</p>
            <p className="text-sm text-muted-foreground mt-1">Install skills to add new tools and capabilities</p>
          </div>
        )}
      </div>
    </div>
  );
}
