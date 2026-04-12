import { useState } from "react";
import { Shield, Globe, AlertCircle, CheckCircle2, XCircle, Copy, ExternalLink } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { toast } from "../../components/Toast";

interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  hostname?: string;
  tailscaleIp?: string;
  dnsName?: string;
  url?: string | null;
}

interface VpnSettings {
  enabled: boolean;
  funnel: boolean;
}

interface VpnSettingsProps {
  vpn?: VpnSettings;
  tailscale?: TailscaleStatus;
  onUpdate: (settings: VpnSettings) => Promise<void>;
}

export function VpnSettings({ vpn, tailscale, onUpdate }: VpnSettingsProps) {
  const [isEnabled, setIsEnabled] = useState(vpn?.enabled ?? true);
  const [isFunnel, setIsFunnel] = useState(vpn?.funnel ?? false);
  const [isSaving, setIsSaving] = useState(false);

  const handleToggleEnabled = async () => {
    const newValue = !isEnabled;
    setIsEnabled(newValue);
    setIsSaving(true);
    try {
      await onUpdate({ enabled: newValue, funnel: isFunnel });
      toast.success("VPN settings saved", `Tailscale auto-detect ${newValue ? "enabled" : "disabled"}`);
    } catch (err: any) {
      toast.error("Failed to save", err.message || "Unknown error");
      setIsEnabled(!newValue);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleFunnel = async () => {
    const newValue = !isFunnel;
    setIsFunnel(newValue);
    setIsSaving(true);
    try {
      await onUpdate({ enabled: isEnabled, funnel: newValue });
      toast.success("VPN settings saved", `Funnel ${newValue ? "enabled" : "disabled"}. Requires restart.`);
    } catch (err: any) {
      toast.error("Failed to save", err.message || "Unknown error");
      setIsFunnel(!newValue);
    } finally {
      setIsSaving(false);
    }
  };

  const copyUrl = () => {
    if (tailscale?.url) {
      navigator.clipboard.writeText(tailscale.url);
      toast.success("Copied", "Tailscale URL copied to clipboard");
    }
  };

  const openUrl = () => {
    if (tailscale?.url) {
      window.open(tailscale.url, "_blank");
    }
  };

  const getStatusIcon = () => {
    if (!tailscale?.installed) return <XCircle className="w-5 h-5 text-muted-foreground" />;
    if (tailscale?.running) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    return <AlertCircle className="w-5 h-5 text-amber-500" />;
  };

  const getStatusText = () => {
    if (!tailscale?.installed) return "Tailscale not installed";
    if (tailscale?.running) {
      return `Connected: ${tailscale.hostname || "Unknown device"}`;
    }
    return "Tailscale installed but not running";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">VPN & Remote Access</h2>
          <p className="text-sm text-muted-foreground">
            Configure Tailscale for secure remote access to Kai
          </p>
        </div>
        <Shield className="w-6 h-6 text-primary" />
      </div>

      {/* Status Card with URL */}
      <div className="bg-muted/50 border border-border rounded-lg p-4">
        <div className="flex items-start gap-3">
          {getStatusIcon()}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Tailscale Status</p>
            <p className="text-sm text-muted-foreground">{getStatusText()}</p>
            
            {/* Tailscale URL - shown when running */}
            {tailscale?.running && tailscale?.url && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-xs text-green-700 font-medium mb-1">Access Kai from anywhere on your tailnet:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-white px-2 py-1 rounded border border-green-200 truncate">
                    {tailscale.url}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={copyUrl}
                    title="Copy URL"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={openUrl}
                    title="Open URL"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="space-y-4">
        {/* Auto-enable Tailscale */}
        <div className="flex items-center justify-between p-4 border border-border rounded-lg">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              <span className="font-medium">Auto-enable Tailscale</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Automatically use Tailscale serve when available
            </p>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggleEnabled}
            disabled={isSaving || !tailscale?.installed}
          />
        </div>

        {/* Funnel (public internet) */}
        <div className="flex items-center justify-between p-4 border border-border rounded-lg">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              <span className="font-medium">Tailscale Funnel</span>
              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded">Beta</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Expose Kai to the public internet (requires Tailscale Funnel)
            </p>
            <p className="text-xs text-amber-600">
              Restart required after changing this setting
            </p>
          </div>
          <Switch
            checked={isFunnel}
            onCheckedChange={handleToggleFunnel}
            disabled={isSaving || !tailscale?.installed || !isEnabled}
          />
        </div>
      </div>
    </div>
  );
}
