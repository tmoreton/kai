import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Trash2, MailOpen, AlertCircle, RefreshCw } from "lucide-react";
import { notificationsQueries } from "../api/queries";
import { api, NetworkError, TimeoutError } from "../api/client";
import { timeAgo, cn } from "../lib/utils";
import { toast } from "../components/Toast";
import type { Notification } from "../types/api";

interface ErrorState {
  message: string;
  type: 'network' | 'timeout' | 'server' | 'unknown';
  recoverable: boolean;
}

export function NotificationsView() {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const queryClient = useQueryClient();

  const { data, isError, error: queryError, refetch } = useSuspenseQuery({
    ...notificationsQueries.list(),
    retry: 2,
  });

  // Handle load errors
  if (isError && queryError && !error) {
    let errorState: ErrorState;
    
    if (queryError instanceof NetworkError) {
      errorState = {
        type: 'network',
        message: 'Unable to load notifications. Please check your connection.',
        recoverable: true,
      };
    } else if (queryError instanceof TimeoutError) {
      errorState = {
        type: 'timeout',
        message: 'Loading notifications timed out. Please try again.',
        recoverable: true,
      };
    } else {
      errorState = {
        type: 'unknown',
        message: 'Failed to load notifications.',
        recoverable: true,
      };
    }
    
    setError(errorState);
    toast.error('Notifications Error', errorState.message, 10000);
  }

  const handleRetry = async () => {
    setError(null);
    try {
      await refetch();
      toast.success('Notifications loaded');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed';
      toast.error('Retry failed', message);
    }
  };

  const markReadMutation = useMutation({
    mutationFn: api.notifications.markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationsQueries.all() }),
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to mark as read';
      toast.error('Error', message);
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: api.notifications.markAllRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationsQueries.all() });
      toast.success('All notifications marked as read');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to mark all as read';
      toast.error('Error', message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.notifications.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationsQueries.all() }),
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to delete';
      toast.error('Error', message);
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: api.notifications.deleteAll,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationsQueries.all() });
      toast.success('All notifications cleared');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to clear all';
      toast.error('Error', message);
    },
  });

  const notifications = data?.notifications || [];
  const unreadCount = data?.unread || 0;

  // Error state
  if (error && !notifications.length) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-semibold text-foreground mb-6">Notifications</h1>
          
          <div className="flex flex-col items-center justify-center py-16 px-6 bg-card border border-border rounded-xl">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">
              {error.type === 'network' ? 'Connection Error' : 
               error.type === 'timeout' ? 'Request Timeout' : 'Failed to Load'}
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md text-center">
              {error.message}
            </p>
            {error.recoverable && (
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground">Notifications</h1>
            {unreadCount > 0 && (
              <span className="px-2.5 py-1 bg-primary text-white text-sm font-medium rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {error && error.recoverable && (
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm hover:bg-accent/10"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            )}
            <button
              onClick={() => markAllReadMutation.mutate()}
              disabled={unreadCount === 0 || markAllReadMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm hover:bg-accent/10 disabled:opacity-50"
            >
              <MailOpen className="w-4 h-4" />
              Mark all read
            </button>
            <button
              onClick={() => deleteAllMutation.mutate()}
              disabled={notifications.length === 0 || deleteAllMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              Clear all
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-red-700 flex-1">{error.message}</p>
              {error.recoverable && (
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-2 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {notifications.map((notification: Notification) => (
            <div
              key={notification.id}
              onClick={() => {
                setExpandedId(expandedId === notification.id ? null : notification.id);
                if (!notification.read) {
                  markReadMutation.mutate(notification.id);
                }
              }}
              className={cn(
                "p-5 bg-card border rounded-xl cursor-pointer transition-all",
                notification.read
                  ? "border-border"
                  : "border-primary shadow-sm ring-1 ring-primary/20",
                expandedId === notification.id && "cursor-default"
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5",
                    notification.read ? "bg-muted-foreground" : "bg-primary"
                  )}
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground mb-1">{notification.title}</h3>
                  {expandedId === notification.id ? (
                    <div className="text-muted-foreground leading-relaxed">
                      {notification.message}
                      {notification.attachments && notification.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-4">
                          {notification.attachments.map((att, i) => (
                            <a
                              key={i}
                              href={`/api/attachments?path=${encodeURIComponent(att.path)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-2 bg-background border border-border rounded-lg text-sm hover:border-primary"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {att.type === 'image' ? '🖼️' : '📄'} {att.name}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground truncate">{notification.message}</p>
                  )}
                  <div className="flex items-center gap-4 mt-3">
                    <span className="text-xs text-muted-foreground">{timeAgo(notification.createdAt)}</span>
                    {expandedId === notification.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMutation.mutate(notification.id);
                        }}
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {notifications.length === 0 && (
            <div className="text-center py-16">
              <Bell className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">No notifications yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
