import { useState } from "react";
import { Globe, Share2, Check, X, Loader2, ExternalLink, Copy, CheckCircle2 } from "lucide-react";
import { useTailscale } from "../../hooks/useTailscale";
import { Button } from "../../components/ui/button";
import { toast } from "../../components/Toast";

interface TailscaleSettingsProps {
  port: number;
}

export function TailscaleSettings({ port }: TailscaleSettingsProps) {
  const tailscale = useTailscale(port);
  const [copied, setCopied] = useState(false);

  // Check if we're in Tauri context
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const handleCopy = async () => {
    if (!tailscale.url) return;
    
    try {
      await navigator.clipboard.writeText(tailscale.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('URL copied', 'Tailscale URL copied to clipboard');
    } catch {
      toast.error('Failed to copy', 'Could not copy URL to clipboard');
    }
  };

  if (!isTauri) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-amber-500" />
            <div>
              <p className="font-medium text-amber-800">Tailscale not available</p>
              <p className="text-sm text-amber-600">
                Network sharing requires the Kai desktop app. Install the macOS app to access this feature.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <div className="p-4 bg-card border border-border rounded-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              tailscale.running ? 'bg-green-100' : tailscale.installed ? 'bg-amber-100' : 'bg-red-100'
            }`}>
              <Globe className={`w-5 h-5 ${
                tailscale.running ? 'text-green-600' : tailscale.installed ? 'text-amber-600' : 'text-red-600'
              }`} />
            </div>
            <div>
              <h3 className="font-medium text-foreground">
                {tailscale.running 
                  ? 'Tailscale Connected' 
                  : tailscale.installed 
                  ? 'Tailscale App Installed (Not Connected)' 
                  : 'Tailscale Not Installed'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {tailscale.running && tailscale.dns_name
                  ? `Your Tailscale is active. You can now share Kai.`
                  : tailscale.installed
                  ? 'Open the Tailscale macOS app and connect to your tailnet to enable sharing'
                  : 'Install the Tailscale macOS app from tailscale.com/download'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tailscale.loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              tailscale.running
                ? 'bg-green-100 text-green-800'
                : tailscale.installed
                ? 'bg-amber-100 text-amber-800'
                : 'bg-red-100 text-red-800'
            }`}>
              {tailscale.running ? (
                <><Check className="w-3 h-3 mr-1" /> Active</>
              ) : tailscale.installed ? (
                <><X className="w-3 h-3 mr-1" /> Stopped</>
              ) : (
                <><X className="w-3 h-3 mr-1" /> Missing</>
              )}
            </span>
          </div>
        </div>

        {tailscale.error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {tailscale.error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          {!tailscale.installed ? (
            <Button
              onClick={() => window.open('https://tailscale.com/download', '_blank')}
              variant="default"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Install Tailscale
            </Button>
          ) : !tailscale.running ? (
            <Button
              onClick={() => window.open('tailwind://', '_blank')}
              variant="default"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Tailscale App
            </Button>
          ) : tailscale.url ? (
            <>
              <Button onClick={tailscale.stop} variant="outline">
                Stop Sharing
              </Button>
              <Button onClick={handleCopy} variant="secondary">
                {copied ? (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> Copied</>
                ) : (
                  <><Copy className="w-4 h-4 mr-2" /> Copy URL</>
                )}
              </Button>
              <Button onClick={() => tailscale.url && window.open(tailscale.url, '_blank')} variant="default">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open
              </Button>
            </>
          ) : (
            <>
              <Button 
                onClick={tailscale.startServe} 
                disabled={tailscale.loading}
                variant="default"
              >
                {tailscale.loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting...</>
                ) : (
                  <><Share2 className="w-4 h-4 mr-2" /> Share to Tailnet</>
                )}
              </Button>
              <Button 
                onClick={tailscale.startFunnel} 
                disabled={tailscale.loading}
                variant="outline"
              >
                {tailscale.loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting...</>
                ) : (
                  <><Globe className="w-4 h-4 mr-2" /> Share to Internet (Funnel)</>
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="p-4 bg-muted/50 rounded-lg">
          <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
            <Share2 className="w-4 h-4" />
            Tailnet Sharing
          </h4>
          <p className="text-sm text-muted-foreground">
            Share Kai with anyone on your Tailscale network (same account). Uses your Tailscale hostname with automatic HTTPS.
          </p>
        </div>

        <div className="p-4 bg-muted/50 rounded-lg">
          <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Public Funnel
          </h4>
          <p className="text-sm text-muted-foreground">
            Expose Kai to the public internet via Tailscale Funnel. Anyone with the URL can access it — requires Tailscale account.
          </p>
        </div>
      </div>

      {/* How it works */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="font-medium text-blue-800 mb-2">How it works</h4>
        <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
          <li>Install and open the Tailscale macOS app</li>
          <li>Sign in to your Tailscale account in the Tailscale app (not here)</li>
          <li>Return to Kai and click "Share" — that's it!</li>
        </ol>
        <p className="text-sm text-blue-600 mt-2">
          Kai uses your existing Tailscale connection. We never see your credentials.
        </p>
      </div>

      {/* URL Display */}
      {tailscale.url && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <label className="text-sm font-medium text-green-800 mb-1 block">
            Your Kai is accessible at:
          </label>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-white border border-green-300 rounded text-sm font-mono text-green-700 truncate">
              {tailscale.url}
            </code>
            <Button onClick={handleCopy} variant="ghost" size="sm">
              {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
