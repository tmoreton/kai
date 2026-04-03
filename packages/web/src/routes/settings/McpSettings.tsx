import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Server, Plus, Trash2, AlertCircle } from "lucide-react";
import { settingsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { cn } from "../../lib/utils";
import { toast } from "../../components/Toast";
import type { McpServer } from "../../types/api";

const MCP_EXAMPLE_JSON = `{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/yourname/Documents"]
}

// Other examples:
// GitHub: { "name": "github", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
// Puppeteer: { "name": "puppeteer", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-puppeteer"] }
// Fetch: { "name": "fetch", "command": "uvx", "args": ["mcp-server-fetch"] }`;

export function McpSettings() {
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
              Browse official servers
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
