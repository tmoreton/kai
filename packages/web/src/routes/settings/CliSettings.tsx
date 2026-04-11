import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Terminal, Check, AlertTriangle, Copy } from "lucide-react";
import { settingsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { toast } from "../../components/Toast";

export function CliSettings() {
  const { data, isLoading } = useQuery(settingsQueries.cli());
  const queryClient = useQueryClient();
  const [sudoCommand, setSudoCommand] = useState<string | null>(null);

  const installMutation = useMutation({
    mutationFn: () => api.settings.installCli(),
    onSuccess: (result: any) => {
      if (result.error) {
        if (result.needsSudo) {
          setSudoCommand(result.error.replace("Permission denied. Try running: ", ""));
          toast.warning("Permissions required", "Run the command shown below in your terminal.");
        } else {
          toast.error("Install failed", result.error);
        }
        return;
      }
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      setSudoCommand(null);
      toast.success("CLI installed", `'kai' command is now available in your terminal`);
    },
    onError: (err: any) => {
      const body = err.data;
      if (body?.needsSudo) {
        const cmd = body.error?.replace("Permission denied. Try running: ", "") || "sudo ln -sf ~/.kai/bin/kai /usr/local/bin/kai";
        setSudoCommand(cmd);
        toast.warning("Permissions required", "Run the command shown below in your terminal.");
      } else {
        const message = err instanceof Error ? err.message : "Failed to install CLI";
        toast.error("Install failed", message);
      }
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: () => api.settings.uninstallCli(),
    onSuccess: (result: any) => {
      if (result.error) {
        if (result.needsSudo) {
          const cmd = result.error.replace("Permission denied. Try running: ", "") || "sudo rm /usr/local/bin/kai";
          setSudoCommand(cmd);
          toast.warning("Permissions required", "Run the command shown below in your terminal.");
        } else {
          toast.error("Uninstall failed", result.error);
        }
        return;
      }
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      setSudoCommand(null);
      toast.success("CLI uninstalled", "'kai' command has been removed");
    },
    onError: (err: any) => {
      const body = err.data;
      if (body?.needsSudo) {
        const cmd = body.error?.replace("Permission denied. Try running: ", "") || "sudo rm /usr/local/bin/kai";
        setSudoCommand(cmd);
        toast.warning("Permissions required", "Run the command shown below in your terminal.");
      } else {
        const message = err instanceof Error ? err.message : "Failed to uninstall CLI";
        toast.error("Uninstall failed", message);
      }
    },
  });

  const copyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    toast.success("Copied to clipboard");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Checking CLI status...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-kai-text">CLI Tool</h3>
        <p className="text-sm text-muted-foreground">
          Install the <code className="px-1.5 py-0.5 bg-kai-bg rounded text-xs font-mono">kai</code> command
          to use Kai from your terminal.
        </p>
      </div>

      <div className="p-4 bg-kai-bg rounded-lg space-y-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${data?.installed ? "bg-green-500/10" : "bg-muted"}`}>
            {data?.installed ? (
              <Check className="w-5 h-5 text-green-500" />
            ) : (
              <Terminal className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1">
            <p className="font-medium text-kai-text">
              {data?.installed ? "CLI is installed" : "CLI is not installed"}
            </p>
            {data?.installed && data.path && (
              <p className="text-xs text-muted-foreground font-mono">{data.path}</p>
            )}
          </div>
          {data?.installed ? (
            <button
              onClick={() => uninstallMutation.mutate()}
              disabled={uninstallMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-destructive border border-destructive/30 rounded-lg hover:bg-destructive/10 disabled:opacity-50 transition-colors"
            >
              {uninstallMutation.isPending ? "Removing..." : "Uninstall CLI"}
            </button>
          ) : data?.needsSudo ? (
            <button
              onClick={() => installMutation.mutate()}
              disabled={installMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 disabled:opacity-50 transition-colors"
            >
              {installMutation.isPending ? "Fixing..." : "Fix CLI Installation"}
            </button>
          ) : (
            <button
              onClick={() => installMutation.mutate()}
              disabled={installMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-kai-teal rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {installMutation.isPending ? "Installing..." : "Install CLI"}
            </button>
          )}
        </div>
      </div>

      {sudoCommand && (
        <div className="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-kai-text">Permission required</p>
              <p className="text-xs text-muted-foreground">
                Run this command in your terminal to complete the installation:
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-kai-bg rounded-lg font-mono text-sm">
            <code className="flex-1 text-primary">{sudoCommand}</code>
            <button
              onClick={() => copyCommand(sudoCommand)}
              className="p-1.5 text-muted-foreground hover:text-kai-text rounded hover:bg-accent/20 transition-colors"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="text-xs text-muted-foreground space-y-1">
        <p>After installation, open a new terminal and run:</p>
        <code className="block p-2 bg-kai-bg rounded font-mono">kai --help</code>
      </div>
    </div>
  );
}
