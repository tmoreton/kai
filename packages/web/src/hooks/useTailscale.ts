import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  hostname: string | null;
  dns_name: string | null;
}

export interface TailscaleActions {
  checkStatus: () => Promise<void>;
  startServe: () => Promise<void>;
  startFunnel: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useTailscale(port: number): TailscaleStatus & TailscaleActions & { url: string | null; error: string | null; loading: boolean } {
  const [status, setStatus] = useState<TailscaleStatus>({
    installed: false,
    running: false,
    hostname: null,
    dns_name: null,
  });
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Check if we're in Tauri context
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const checkStatus = useCallback(async () => {
    if (!isTauri) return;
    
    try {
      setLoading(true);
      const result = await invoke<TailscaleStatus>('tailscale_status');
      setStatus(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check Tailscale status');
    } finally {
      setLoading(false);
    }
  }, [isTauri]);

  const startServe = useCallback(async () => {
    if (!isTauri) return;
    
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<string>('tailscale_start_serve', { port });
      setUrl(result);
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Tailscale serve');
    } finally {
      setLoading(false);
    }
  }, [isTauri, port, checkStatus]);

  const startFunnel = useCallback(async () => {
    if (!isTauri) return;
    
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<string>('tailscale_start_funnel', { port });
      setUrl(result);
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Tailscale funnel');
    } finally {
      setLoading(false);
    }
  }, [isTauri, port, checkStatus]);

  const stop = useCallback(async () => {
    if (!isTauri) return;
    
    try {
      setLoading(true);
      await invoke('tailscale_stop');
      setUrl(null);
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop Tailscale');
    } finally {
      setLoading(false);
    }
  }, [isTauri, checkStatus]);

  // Check status on mount
  useEffect(() => {
    if (isTauri) {
      checkStatus();
    }
  }, [isTauri, checkStatus]);

  return {
    ...status,
    url,
    error,
    loading,
    checkStatus,
    startServe,
    startFunnel,
    stop,
  };
}
