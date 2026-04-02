import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings as SettingsIcon, Server, Puzzle, Key, Brain, FileText, Save, RotateCcw, Plus, Trash2, AlertCircle } from "lucide-react";
import { settingsQueries } from "../api/queries";
import { api, ApiError, NetworkError, TimeoutError } from "../api/client";
import { cn } from "../lib/utils";
import { toast } from "../components/Toast";
import type { McpServer, Skill, Settings as SettingsType } from "../types/api";

type TabType = 'general' | 'mcp' | 'skills' | 'env' | 'soul' | 'context';

interface ErrorState {
  message: string;
  type: 'error' | 'warning';
}

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [error, setError] = useState<ErrorState | null>(null);

  const { data: settings, isError, error: queryError, refetch } = useSuspenseQuery({
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
          <TabButton active={activeTab === 'general'} onClick={() => setActiveTab('general')} icon={<SettingsIcon className="w-4 h-4" />}>
            General
          </TabButton>
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
          {activeTab === 'general' && <GeneralSettings settings={settings} />}
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

function GeneralSettings({ settings }: { settings: SettingsType }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-kai-text mb-2">Configuration</label>
        <pre className="bg-kai-bg p-3 rounded-lg text-sm text-muted-foreground overflow-auto">
          {JSON.stringify(settings.config, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function McpSettings() {
  const { data: settings } = useSuspenseQuery(settingsQueries.list());
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', command: '', args: '' });

  const addMutation = useMutation({
    mutationFn: (server: { name: string; command: string; args: string }) =>
      api.settings.addMcpServer({
        name: server.name,
        command: server.command,
        args: server.args.split(',').map(s => s.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      setShowAdd(false);
      setNewServer({ name: '', command: '', args: '' });
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-kai-text">MCP Servers</h3>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-kai-teal text-white rounded-lg text-sm hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" />
          Add Server
        </button>
      </div>

      {showAdd && (
        <div className="p-4 bg-kai-bg rounded-lg space-y-3">
          <input
            type="text"
            placeholder="Server name"
            value={newServer.name}
            onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
            className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm"
          />
          <input
            type="text"
            placeholder="Command (e.g., npx)"
            value={newServer.command}
            onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
            className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm"
          />
          <input
            type="text"
            placeholder="Arguments (comma-separated)"
            value={newServer.args}
            onChange={(e) => setNewServer({ ...newServer, args: e.target.value })}
            className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => addMutation.mutate(newServer)}
              disabled={addMutation.isPending}
              className="px-4 py-2 bg-kai-teal text-white rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {addMutation.isPending ? 'Adding...' : 'Add'}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {settings.mcp.servers.map((server: McpServer) => (
          <div key={server.name} className="flex items-center justify-between p-3 bg-kai-bg rounded-lg">
            <div>
              <div className="font-medium text-kai-text">{server.name}</div>
              <div className="text-sm text-muted-foreground">
                {server.config.command} {server.config.args?.join(' ')}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn("w-2 h-2 rounded-full", server.ready ? "bg-kai-green" : "bg-kai-red")} />
                <span className="text-xs text-muted-foreground">
                  {server.ready ? 'Ready' : 'Not ready'} • {server.tools.length} tools
                </span>
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
          <div className="text-muted-foreground text-center py-8">
            <Server className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p>No MCP servers configured</p>
            <p className="text-sm text-muted-foreground mt-1">Add a server to extend Kai's capabilities</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillsSettings() {
  const { data: settings } = useSuspenseQuery(settingsQueries.list());
  const queryClient = useQueryClient();
  const [installSource, setInstallSource] = useState("");

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
        <h3 className="font-semibold text-kai-text">Installed Skills</h3>
        <button
          onClick={() => reloadMutation.mutate()}
          disabled={reloadMutation.isPending}
          className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-accent/10"
        >
          <RotateCcw className={cn("w-4 h-4", reloadMutation.isPending && "animate-spin")} />
          Reload
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="GitHub URL or npm package to install..."
          value={installSource}
          onChange={(e) => setInstallSource(e.target.value)}
          className="flex-1 px-3 py-2 bg-kai-bg border border-border rounded-lg text-sm"
        />
        <button
          onClick={() => installMutation.mutate(installSource)}
          disabled={!installSource || installMutation.isPending}
          className="px-4 py-2 bg-kai-teal text-white rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {installMutation.isPending ? 'Installing...' : 'Install'}
        </button>
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

function EnvSettings() {
  const { data } = useSuspenseQuery(settingsQueries.env());
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

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
      <h3 className="font-semibold text-kai-text">Environment Variables</h3>

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
