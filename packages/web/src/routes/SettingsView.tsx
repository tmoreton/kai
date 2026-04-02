import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Server, Puzzle, Key, Brain, FileText, Save, RotateCcw, Plus, Trash2, AlertCircle } from "lucide-react";
import { settingsQueries } from "../api/queries";
import { api, ApiError, NetworkError, TimeoutError } from "../api/client";
import { cn } from "../lib/utils";
import { toast } from "../components/Toast";
import type { McpServer, Skill } from "../types/api";

type TabType = 'mcp' | 'skills' | 'env' | 'soul' | 'context';

interface ErrorState {
  message: string;
  type: 'error' | 'warning';
}

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<TabType>('mcp');
  const [error, setError] = useState<ErrorState | null>(null);

  const { isError, error: queryError, refetch } = useSuspenseQuery({
    ...settingsQueries.list(),
    retry: 2,
  });

  // Handle initial load errors
  if (isError && queryError && !error) {
    let errorMessage = 'Failed to load settings';
    if (queryError instanceof NetworkError) {
      errorMessage = 'Unable to connect to server. Please check your connection.';
    } else if (queryError instanceof TimeoutError) {
      errorMessage = 'Settings load timed out. Please try again.';
    } else if (queryError instanceof ApiError) {
      errorMessage = queryError.message;
    }
    setError({ message: errorMessage, type: 'error' });
    toast.error('Settings Error', errorMessage, 10000);
  }

  const handleRetry = async () => {
    setError(null);
    try {
      await refetch();
      toast.success('Settings loaded', 'Successfully reconnected');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed';
      setError({ message, type: 'error' });
      toast.error('Retry failed', message);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-kai-text mb-2">Settings</h1>
        <p className="text-muted-foreground mb-6">
          Configure MCP servers, manage skills, and adjust preferences.
        </p>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-red-700 flex-1">{error.message}</p>
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Retry
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
          <TabButton active={activeTab === 'mcp'} onClick={() => setActiveTab('mcp')} icon={<Server className="w-4 h-4" />}>
            MCP Servers
          </TabButton>
          <TabButton active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} icon={<Puzzle className="w-4 h-4" />}>
            Skills
          </TabButton>
          <TabButton active={activeTab === 'env'} onClick={() => setActiveTab('env')} icon={<Key className="w-4 h-4" />}>
            Environment
          </TabButton>
          <TabButton active={activeTab === 'soul'} onClick={() => setActiveTab('soul')} icon={<Brain className="w-4 h-4" />}>
            Soul
          </TabButton>
          <TabButton active={activeTab === 'context'} onClick={() => setActiveTab('context')} icon={<FileText className="w-4 h-4" />}>
            Context
          </TabButton>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          {activeTab === 'mcp' && <McpSettings />}
          {activeTab === 'skills' && <SkillsSettings />}
          {activeTab === 'env' && <EnvSettings />}
          {activeTab === 'soul' && <SoulSettings />}
          {activeTab === 'context' && <ContextSettings />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-kai-text hover:border-border"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

const MCP_EXAMPLE_JSON = `{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/yourname/Documents"]
}

// Other examples:
// GitHub: { "name": "github", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
// Puppeteer: { "name": "puppeteer", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-puppeteer"] }
// Fetch: { "name": "fetch", "command": "uvx", "args": ["mcp-server-fetch"] }`;

function McpSettings() {
  const { data: settings } = useSuspenseQuery(settingsQueries.list());
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [jsonInput, setJsonInput] = useState(MCP_EXAMPLE_JSON);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (server: { name: string; command: string; args: string[] }) =>
      api.settings.addMcpServer(server),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      setShowAdd(false);
      setJsonInput(MCP_EXAMPLE_JSON);
      setJsonError(null);
      toast.success('MCP Server added', 'Server configuration saved successfully');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to add server';
      toast.error('Failed to add server', message);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (name: string) => api.settings.removeMcpServer(name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success('Server removed', `${name} has been removed`);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to remove server';
      toast.error('Failed to remove server', message);
    },
  });

  const handleAdd = () => {
    try {
      // Extract just the first JSON object (ignore comments)
      const jsonMatch = jsonInput.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        setJsonError('No valid JSON object found');
        return;
      }
      const parsed = JSON.parse(jsonMatch[0]);
      
      if (!parsed.name || !parsed.command) {
        setJsonError('JSON must include "name" and "command" fields');
        return;
      }
      
      setJsonError(null);
      addMutation.mutate({
        name: parsed.name,
        command: parsed.command,
        args: parsed.args || [],
      });
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-kai-text">MCP Servers</h3>
          <p className="text-sm text-muted-foreground">Add Model Context Protocol servers to extend capabilities</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-3 py-1.5 bg-kai-teal text-white rounded-lg text-sm hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" />
          {showAdd ? 'Cancel' : 'Add Server'}
        </button>
      </div>

      {showAdd && (
        <div className="p-4 bg-kai-bg rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <label className="font-medium text-kai-text">Server Configuration (JSON)</label>
            <a 
              href="https://github.com/modelcontextprotocol/servers" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Browse official servers →
            </a>
          </div>
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            className="w-full h-48 px-3 py-2 bg-card border border-border rounded-lg text-sm font-mono resize-none focus:border-primary outline-none"
            placeholder='{ "name": "server-name", "command": "npx", "args": ["..."] }'
            spellCheck={false}
          />
          {jsonError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4" />
              {jsonError}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={addMutation.isPending}
              className="px-4 py-2 bg-kai-teal text-white rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {addMutation.isPending ? 'Adding...' : 'Add Server'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {settings.mcp.servers.map((server: McpServer) => (
          <div key={server.name} className="flex items-center justify-between p-4 bg-kai-bg rounded-lg border border-border/50">
            <div className="flex items-start gap-3">
              <div className={cn("w-2 h-2 rounded-full mt-2", server.ready ? "bg-kai-green" : "bg-kai-red")} />
              <div>
                <div className="font-medium text-kai-text">{server.name}</div>
                <div className="text-sm text-muted-foreground font-mono mt-0.5">
                  {server.config.command} {server.config.args?.join(' ')}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className={cn("text-xs px-2 py-0.5 rounded-full", server.ready ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                    {server.ready ? 'Ready' : 'Not ready'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {server.tools.length} tools
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => removeMutation.mutate(server.name)}
              disabled={removeMutation.isPending}
              className="p-2 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {settings.mcp.servers.length === 0 && (
          <div className="text-center py-12 border border-dashed border-border rounded-lg">
            <Server className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
            <p className="text-muted-foreground font-medium">No MCP servers configured</p>
            <p className="text-sm text-muted-foreground mt-1">Add a server to extend Kai's capabilities</p>
          </div>
        )}
      </div>
    </div>
  );
}

const SKILL_EXAMPLES = [
  'github:tmoreton/kai-skill-example',
  'npm:@kai-tools/skill-example',
];

function SkillsSettings() {
  const { data: settings } = useSuspenseQuery(settingsQueries.list());
  const queryClient = useQueryClient();
  const [installSource, setInstallSource] = useState("");
  const [showExamples, setShowExamples] = useState(false);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-kai-text">Installed Skills</h3>
          <p className="text-sm text-muted-foreground">Skills add custom tools and capabilities</p>
        </div>
        <button
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
          className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-accent/10"
        >
          <RotateCcw className={cn("w-4 h-4", reloadMutation.isPending && "animate-spin")} />
          Reload
        </button>
      </div>

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
                v{skill.version} • {skill.tools.length} tools • {skill.path}
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

const ENV_EXAMPLES = [
  { key: 'ANTHROPIC_API_KEY', value: 'sk-ant-...', description: 'Claude API access' },
  { key: 'OPENAI_API_KEY', value: 'sk-...', description: 'OpenAI API access' },
  { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: 'ghp_...', description: 'GitHub MCP server' },
];

function EnvSettings() {
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
              <span className="text-muted-foreground ml-2">— {ex.description}</span>
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

function SoulSettings() {
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

function ContextSettings() {
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
