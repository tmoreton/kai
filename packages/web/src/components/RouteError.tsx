import { useRouteError, isRouteErrorResponse, useNavigate, Link } from "react-router-dom";
import { useEffect } from "react";
import { AlertTriangle, Home, RefreshCw, MessageSquare, ArrowLeft } from "lucide-react";
import { toast } from "./Toast";
import { NetworkError, TimeoutError } from "../api/client";

export function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();

  let message = "An unexpected error occurred";
  let status = "";
  let isSessionError = false;
  let errorType: 'network' | 'timeout' | 'server' | 'client' | 'unknown' = 'unknown';

  // Process the error
  if (isRouteErrorResponse(error)) {
    status = error.status.toString();
    message = error.statusText || error.data?.message || `Error ${error.status}`;
    
    // Check for session not found
    if (error.status === 404 || error.data?.error?.includes('Session not found')) {
      isSessionError = true;
      message = "This chat session doesn't exist or has been deleted.";
      errorType = 'server';
    } else if (error.status >= 500) {
      errorType = 'server';
    } else if (error.status === 408) {
      errorType = 'timeout';
    } else {
      errorType = 'client';
    }
  } else if (error instanceof NetworkError) {
    message = error.message;
    errorType = 'network';
    toast.error('Network Error', 'Unable to connect to the server. Please check your connection.', 10000);
  } else if (error instanceof TimeoutError) {
    message = error.message;
    errorType = 'timeout';
    toast.error('Request Timeout', 'The server is taking too long to respond. Please try again.', 10000);
  } else if (error instanceof Error) {
    message = error.message;
    if (message.includes('Session not found') || message.includes('session')) {
      isSessionError = true;
      message = "This chat session doesn't exist or has been deleted.";
      errorType = 'server';
    } else if (message.includes('ChunkLoadError') || message.includes('Loading chunk')) {
      errorType = 'client';
      toast.error('Update Available', 'A new version of the app is available. Please refresh.', 10000);
    }
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === 'object') {
    // Handle raw JSON errors
    const errorData = error as { error?: string; message?: string };
    if (errorData.error?.includes('Session not found')) {
      isSessionError = true;
      message = "This chat session doesn't exist or has been deleted.";
      errorType = 'server';
    } else if (errorData.message) {
      message = errorData.message;
    }
  }

  // Log in development
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.error('Route error:', error);
    }
  }, [error]);

  // Determine if error is retryable
  const isRetryable = errorType === 'network' || errorType === 'timeout' || errorType === 'server';

  // Get appropriate icon background color
  const getIconBgClass = () => {
    switch (errorType) {
      case 'network':
      case 'timeout':
        return 'bg-amber-100';
      case 'server':
        return isSessionError ? 'bg-kai-teal-light' : 'bg-destructive/10';
      case 'client':
        return 'bg-blue-100';
      default:
        return 'bg-destructive/10';
    }
  };

  // Get appropriate icon color
  const getIconColorClass = () => {
    switch (errorType) {
      case 'network':
      case 'timeout':
        return 'text-amber-500';
      case 'server':
        return isSessionError ? 'text-primary' : 'text-destructive';
      case 'client':
        return 'text-blue-500';
      default:
        return 'text-destructive';
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center shadow-lg">
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${getIconBgClass()}`}>
            <AlertTriangle className={`w-8 h-8 ${getIconColorClass()}`} />
          </div>
        </div>

        {/* Status Code (if applicable) */}
        {status && !isSessionError && (
          <div className="text-4xl font-bold text-foreground mb-2">{status}</div>
        )}

        {/* Title */}
        <h1 className="text-xl font-semibold text-foreground mb-2">
          {isSessionError 
            ? "Session not found" 
            : errorType === 'network' 
              ? "Connection Error"
              : errorType === 'timeout'
                ? "Request Timeout"
                : errorType === 'client'
                  ? "Update Available"
                  : "Something went wrong"}
        </h1>

        {/* Message */}
        <p className="text-muted-foreground mb-6">{message}</p>

        {/* Additional guidance based on error type */}
        {errorType === 'network' && (
          <p className="text-sm text-muted-foreground mb-6">
            Please check your internet connection and try again.
          </p>
        )}
        {errorType === 'timeout' && (
          <p className="text-sm text-muted-foreground mb-6">
            The server may be experiencing high load. Please wait a moment and try again.
          </p>
        )}
        {errorType === 'client' && (
          <p className="text-sm text-muted-foreground mb-6">
            An update is available. Refresh the page to get the latest version.
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {isSessionError ? (
            <>
              <button
                onClick={() => navigate('/chat')}
                className="flex items-center gap-2 px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                New Chat
              </button>
              <button
                onClick={() => navigate('/chat')}
                className="flex items-center gap-2 px-4 py-2 bg-accent/10 border border-border rounded-lg text-sm font-medium hover:bg-accent/20 transition-colors"
              >
                <Home className="w-4 h-4" />
                Go Home
              </button>
            </>
          ) : (
            <>
              {/* Retry button for retryable errors */}
              {isRetryable && (
                <button
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-2 px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </button>
              )}

              {/* Go Back button (only if we have history) */}
              {window.history.length > 1 && (
                <button
                  onClick={() => navigate(-1)}
                  className="flex items-center gap-2 px-4 py-2 bg-accent/10 border border-border rounded-lg text-sm font-medium hover:bg-accent/20 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Go Back
                </button>
              )}

              {/* Home button */}
              <Link
                to="/"
                className="flex items-center gap-2 px-4 py-2 bg-accent/10 border border-border rounded-lg text-sm font-medium hover:bg-accent/20 transition-colors"
              >
                <Home className="w-4 h-4" />
                Go Home
              </Link>
            </>
          )}
        </div>

        {/* Footer help text */}
        <p className="mt-6 text-xs text-muted-foreground">
          If this problem persists, please try clearing your browser cache or contact support.
        </p>
      </div>
    </div>
  );
}
