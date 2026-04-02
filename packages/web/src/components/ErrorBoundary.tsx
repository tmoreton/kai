// ============================================
// ErrorBoundary - React class component for catching errors
// ============================================

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, Copy, Check, ArrowLeft } from 'lucide-react';
import { toast } from './Toast';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  resetKeys?: Array<string | number>;
  resetOnPropsChange?: boolean;
}

interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  hasError: boolean;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  private previousResetKeys: Array<string | number> = [];

  constructor(props: Props) {
    super(props);
    this.state = {
      error: null,
      errorInfo: null,
      hasError: false,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      errorInfo: null,
      hasError: true,
      copied: false,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    
    // Log to console in development
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught error:', error);
      console.error('Component stack:', errorInfo.componentStack);
    }

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // Show toast notification for non-critical errors
    if (!this.isCriticalError(error)) {
      toast.error(
        'Something went wrong',
        'The error has been logged. Try refreshing the page.',
        10000
      );
    }
  }

  componentDidUpdate(_prevProps: Props) {
    const { resetKeys, resetOnPropsChange: _resetOnPropsChange } = this.props;
    const { hasError } = this.state;

    // Reset error state when resetKeys change
    if (hasError && resetKeys && resetKeys.length > 0) {
      const hasResetKeyChanged = resetKeys.some(
        (key, index) => key !== this.previousResetKeys[index]
      );
      
      if (hasResetKeyChanged) {
        this.resetErrorBoundary();
        this.previousResetKeys = [...resetKeys];
      }
    }

    // Store current resetKeys for next comparison
    if (resetKeys) {
      this.previousResetKeys = [...resetKeys];
    }
  }

  private isCriticalError(error: Error): boolean {
    // Critical errors that should show full error UI
    const criticalPatterns = [
      'ChunkLoadError',
      'Loading chunk',
      'Importing a module script failed',
      'Failed to load module',
    ];
    
    return criticalPatterns.some(pattern => 
      error.message?.includes(pattern) || 
      error.name?.includes(pattern)
    );
  }

  private resetErrorBoundary = () => {
    this.setState({
      error: null,
      errorInfo: null,
      hasError: false,
      copied: false,
    });
  };

  private handleCopyError = async () => {
    const { error, errorInfo } = this.state;
    if (!error) return;

    const errorText = `
Error: ${error.name}: ${error.message}

Component Stack:
${errorInfo?.componentStack || 'N/A'}

Stack:
${error.stack || 'N/A'}
    `.trim();

    try {
      await navigator.clipboard.writeText(errorText);
      this.setState({ copied: true });
      toast.success('Error details copied to clipboard');
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      toast.error('Failed to copy error details');
    }
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  private handleGoBack = () => {
    window.history.back();
  };

  render() {
    const { hasError, error, errorInfo, copied } = this.state;
    const { children, fallback } = this.props;

    if (!hasError) {
      return children;
    }

    // Custom fallback if provided
    if (fallback) {
      return fallback;
    }

    // Check if it's a chunk loading error (likely needs refresh)
    const isChunkError = error && this.isCriticalError(error);

    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
        <div className="max-w-lg w-full bg-card border border-border rounded-xl p-8 text-center shadow-lg">
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-xl font-semibold text-foreground mb-2">
            {isChunkError ? 'Update Available' : 'Something went wrong'}
          </h1>

          {/* Description */}
          <p className="text-muted-foreground mb-6">
            {isChunkError
              ? 'A new version of the app is available. Please refresh to get the latest updates.'
              : 'We\'re sorry, but something unexpected happened. The error has been logged.'}
          </p>

          {/* Error Details (collapsed by default) */}
          {error && (
            <div className="mb-6">
              <details className="group">
                <summary className="flex items-center justify-between p-3 bg-kai-bg rounded-lg cursor-pointer text-sm text-muted-foreground hover:bg-accent/10 transition-colors">
                  <span>Error Details</span>
                  <span className="transition-transform group-open:rotate-180">▼</span>
                </summary>
                <div className="mt-2 p-3 bg-kai-bg rounded-lg text-left">
                  <p className="text-sm font-mono text-red-600 dark:text-red-400 mb-2">
                    {error.name}: {error.message}
                  </p>
                  {errorInfo && (
                    <pre className="text-xs font-mono text-muted-foreground overflow-auto max-h-48 whitespace-pre-wrap">
                      {errorInfo.componentStack}
                    </pre>
                  )}
                  {error.stack && (
                    <pre className="text-xs font-mono text-muted-foreground overflow-auto max-h-48 mt-2 whitespace-pre-wrap">
                      {error.stack}
                    </pre>
                  )}
                </div>
              </details>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            {isChunkError ? (
              <button
                onClick={this.handleReload}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Page
              </button>
            ) : (
              <>
                <button
                  onClick={this.handleGoBack}
                  className="flex items-center gap-2 px-4 py-2 bg-accent/10 border border-border rounded-lg text-sm font-medium hover:bg-accent/20 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Go Back
                </button>

                <button
                  onClick={this.resetErrorBoundary}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </button>

                <button
                  onClick={this.handleGoHome}
                  className="flex items-center gap-2 px-4 py-2 bg-accent/10 border border-border rounded-lg text-sm font-medium hover:bg-accent/20 transition-colors"
                >
                  <Home className="w-4 h-4" />
                  Go Home
                </button>

                {error && (
                  <button
                    onClick={this.handleCopyError}
                    className="flex items-center gap-2 px-4 py-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 text-green-500" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy Error
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <p className="mt-6 text-xs text-muted-foreground">
            If this problem persists, please try clearing your browser cache or contact support.
          </p>
        </div>
      </div>
    );
  }
}

// ============================================
// Hook for async error handling
// ============================================

import { useState, useCallback } from 'react';

interface UseErrorHandlerReturn<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  isError: boolean;
  execute: (...args: unknown[]) => Promise<T | null>;
  reset: () => void;
  retry: () => void;
}

export function useErrorHandler<T>(
  asyncFunction: (...args: unknown[]) => Promise<T>,
  options?: {
    onError?: (error: Error) => void;
    onSuccess?: (data: T) => void;
    showToast?: boolean;
    errorMessage?: string;
  }
): UseErrorHandlerReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [_retryCount, setRetryCount] = useState(0);
  const [lastArgs, setLastArgs] = useState<unknown[] | null>(null);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
    setRetryCount(0);
    setLastArgs(null);
  }, []);

  const execute = useCallback(
    async (...args: unknown[]): Promise<T | null> => {
      setIsLoading(true);
      setError(null);
      setLastArgs(args);

      try {
        const result = await asyncFunction(...args);
        setData(result);
        options?.onSuccess?.(result);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        options?.onError?.(error);

        if (options?.showToast !== false) {
          toast.error(
            options?.errorMessage || 'Operation failed',
            error.message,
            8000
          );
        }
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [asyncFunction, options]
  );

  const retry = useCallback(() => {
    if (lastArgs) {
      setRetryCount((count) => count + 1);
      execute(...lastArgs);
    }
  }, [lastArgs, execute]);

  return {
    data,
    error,
    isLoading,
    isError: error !== null,
    execute,
    reset,
    retry,
  };
}

// ============================================
// AsyncBoundary - For suspense-like error handling
// ============================================

interface AsyncBoundaryProps {
  children: ReactNode;
  loading?: ReactNode;
  error?: (props: { error: Error; reset: () => void }) => ReactNode;
}

export function AsyncBoundary({
  children,
  loading: _loading,
  error: ErrorComponent,
}: AsyncBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={
        ErrorComponent ? (
          <div role="alert">
            {ErrorComponent({
              error: new Error('Something went wrong'),
              reset: () => window.location.reload(),
            })}
          </div>
        ) : undefined
      }
    >
      {children}
    </ErrorBoundary>
  );
}
