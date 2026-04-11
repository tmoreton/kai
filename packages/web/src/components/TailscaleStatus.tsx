import { Globe, Wifi } from 'lucide-react';

interface TailscaleStatusProps {
  url: string;
}

export function TailscaleStatus({ url }: TailscaleStatusProps) {
  const isTailscale = url.includes('.ts.net') || url.includes('tailscale');
  
  if (!isTailscale) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground bg-muted/50 rounded">
        <Wifi className="w-3 h-3" />
        <span>Local</span>
      </div>
    );
  }
  
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-green-700 bg-green-50 rounded" title={`Accessible via Tailscale: ${url}`}>
      <Globe className="w-3 h-3" />
      <span>Tailscale</span>
    </div>
  );
}
