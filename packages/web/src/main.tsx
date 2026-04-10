import { Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { Logo } from "./components/Logo";
import "./index.css";

// Extend Window interface for PWA types
declare global {
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{
      outcome: 'accepted' | 'dismissed';
      platform: string;
    }>;
    prompt(): Promise<void>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
    pwaInstallReady: CustomEvent<BeforeInstallPromptEvent>;
    pwaInstalled: CustomEvent<void>;
  }
}

// Create Query Client with Kai-specific configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60000, // 1 minute - data stays fresh longer to reduce API calls
      gcTime: 10 * 60 * 1000, // 10 minutes - keep inactive data in cache longer
      refetchOnWindowFocus: false, // Disable refetch on window focus - reduces unnecessary calls
      refetchOnReconnect: true, // Only refetch when coming back online
      refetchIntervalInBackground: false, // Disable background polling
      retry: (failureCount, error) => {
        // Retry on network errors, but not on 4xx client errors
        if (error instanceof Error && error.message.includes('4')) {
          return false;
        }
        return failureCount < 2; // Max 2 retries
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    },
  },
});

// Register PWA service worker
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('SW registered: ', registration);
          
          // Listen for updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New update available
                  console.log('New content available, please refresh.');
                }
              });
            }
          });
        })
        .catch((error) => {
          console.log('SW registration failed: ', error);
        });

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'SKIP_WAITING') {
          window.location.reload();
        }
      });
    });
  }
}

// PWA Install prompt handler
function usePWAInstall() {
  useEffect(() => {
    // Store install prompt event for programmatic triggering if needed
    let deferredPrompt: BeforeInstallPromptEvent | null = null;

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Store the event for later use
      deferredPrompt = e as BeforeInstallPromptEvent;
      console.log('PWA install prompt ready');
      // Can be used to show custom install button
      window.dispatchEvent(new CustomEvent('pwaInstallReady', { detail: deferredPrompt }));
    };

    const handleAppInstalled = () => {
      console.log('PWA was installed');
      deferredPrompt = null;
      window.dispatchEvent(new CustomEvent('pwaInstalled'));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);
}

function App() {
  usePWAInstall();

  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<LoadingScreen />}>
        <RouterProvider router={router} />
      </Suspense>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

function LoadingScreen() {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Logo className="w-10 h-10 animate-pulse" />
        <p className="text-muted-foreground text-sm">Loading Kai...</p>
      </div>
    </div>
  );
}

// Register service worker
registerServiceWorker();

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
