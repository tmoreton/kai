import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Plus, Users, ChevronRight, Edit, AlertCircle, RefreshCw } from "lucide-react";
import { agentsQueries } from "../api/queries";
import { NetworkError, TimeoutError } from "../api/client";
import { toast } from "../components/Toast";
import { cn } from "../lib/utils";
import type { Agent, Persona } from "../types/api";

interface ErrorState {
  message: string;
  type: 'network' | 'timeout' | 'server' | 'unknown';
  recoverable: boolean;
}

export function AgentsView() {
  const { personaId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<ErrorState | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const { data, isError, error: queryError, refetch } = useSuspenseQuery({
    ...agentsQueries.list(),
    retry: 2,
  });

  // Handle errors
  useEffect(() => {
    if (isError && queryError && !error) {
      let errorState: ErrorState;

      if (queryError instanceof NetworkError) {
        errorState = {
          type: 'network',
          message: 'Unable to connect to the server. Please check your connection.',
          recoverable: true,
        };
      } else if (queryError instanceof TimeoutError) {
        errorState = {
          type: 'timeout',
          message: 'Request timed out. The server may be busy.',
          recoverable: true,
        };
      } else if (queryError instanceof Error && queryError.message?.includes('404')) {
        errorState = {
          type: 'server',
          message: 'Agent data not found.',
          recoverable: false,
        };
      } else {
        errorState = {
          type: 'unknown',
          message: 'Failed to load agents. Please try again.',
          recoverable: true,
        };
      }

      setError(errorState);
      toast.error('Failed to load agents', errorState.message, 10000);
    }
  }, [isError, queryError, error]);

  const handleRetry = async () => {
    setError(null);
    setRetryCount(c => c + 1);
    
    try {
      await refetch();
      toast.success('Agents loaded', 'Successfully reconnected to the server');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed';
      setError({
        type: 'unknown',
        message: 'Still unable to load agents. Please try again later.',
        recoverable: true,
      });
      toast.error('Retry failed', message, 8000);
    }
  };

  // Error state UI
  if (error && !data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-kai-text">Agents</h1>
              <p className="text-muted-foreground mt-1">Manage personas and automated workflows</p>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center py-16 px-6 bg-card border border-border rounded-xl">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <h2 className="text-xl font-semibold text-kai-text mb-2">
              {error.type === 'network' ? 'Connection Error' : 
               error.type === 'timeout' ? 'Request Timeout' : 'Failed to Load'}
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md text-center">
              {error.message}
            </p>
            {error.recoverable && (
              <button
                onClick={handleRetry}
                disabled={retryCount > 3}
                className="flex items-center gap-2 px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${retryCount > 0 ? 'animate-spin' : ''}`} />
                {retryCount > 0 ? 'Retrying...' : 'Try Again'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { personas } = data || { personas: [] };

  if (personaId) {
    return <PersonaDetail personaId={personaId} />;
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-kai-text">Agents</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage personas and automated workflows</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/agents/persona/new')}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-kai-text text-white rounded-lg hover:bg-primary/90 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Persona</span>
              <span className="sm:hidden">New</span>
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {personas.map((persona: Persona) => (
            <PersonaCard
              key={persona.id}
              persona={persona}
              onClick={() => navigate(`/agents/${persona.id}`)}
            />
          ))}
          {personas.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p>No personas yet. Create your first one!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonaCard({
  persona,
  onClick,
}: {
  persona: Persona;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-card border border-border rounded-xl p-5 hover:border-primary hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-11 h-11 rounded-full bg-kai-teal-light flex items-center justify-center text-primary text-xl font-semibold flex-shrink-0">
          {persona.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-kai-text truncate">{persona.name}</h3>
          <p className="text-sm text-muted-foreground truncate">{persona.role}</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
        {persona.personality?.slice(0, 120)}...
      </p>
      <div className="flex items-center justify-end text-sm">
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>
    </button>
  );
}

function PersonaDetail({ personaId }: { personaId: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState<ErrorState | null>(null);

  const { data, isError, error: queryError, refetch } = useSuspenseQuery({
    ...agentsQueries.list(),
    retry: 2,
  });

  useEffect(() => {
    if (isError && queryError && !error) {
      const errorState: ErrorState = {
        type: 'unknown',
        message: queryError instanceof Error ? queryError.message : 'Failed to load persona',
        recoverable: true,
      };
      setError(errorState);
      toast.error('Failed to load persona', errorState.message);
    }
  }, [isError, queryError, error]);

  const persona = data?.personas.find((p: Persona) => p.id === personaId);
  const agents = data?.agents.filter((a: Agent) => a.personaId === personaId) || [];

  if (!persona) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">Persona not found</p>
          <button
            onClick={() => navigate('/agents')}
            className="px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            Back to Agents
          </button>
        </div>
      </div>
    );
  }

  const handleRetry = async () => {
    setError(null);
    try {
      await refetch();
      toast.success('Data refreshed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed';
      toast.error('Retry failed', message);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        <button
          onClick={() => navigate('/agents')}
          className="text-sm text-muted-foreground hover:text-primary mb-4"
        >
          ← Back to Agents
        </button>

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

        <div className="flex items-start gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-kai-teal-light flex items-center justify-center text-primary text-2xl font-semibold">
            {persona.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-kai-text">{persona.name}</h1>
            <p className="text-muted-foreground">{persona.role}</p>
          </div>
          <button
            onClick={() => navigate(`/agents/persona/edit/${personaId}`)}
            className="flex items-center gap-2 px-4 py-2 bg-kai-teal text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Edit className="w-4 h-4" />
            Edit
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-kai-text mb-3">Personality</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{persona.personality}</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold text-kai-text mb-3">Goals</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{persona.goals || 'No goals set'}</p>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="font-semibold text-kai-text mb-4">
            Agents ({agents.length})
          </h3>
          {agents.length === 0 ? (
            <p className="text-muted-foreground">No agents assigned to this persona.</p>
          ) : (
            <div className="space-y-2">
              {agents.map((agent: Agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 p-3 bg-card border border-border rounded-lg"
                >
                  <div className={cn(
                    "w-2.5 h-2.5 rounded-full",
                    agent.enabled ? "bg-green-500" : "bg-kai-text-muted"
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-kai-text">{agent.name}</div>
                    <div className="text-sm text-muted-foreground truncate">{agent.description}</div>
                  </div>
                  {agent.schedule && (
                    <span className="text-xs text-muted-foreground bg-accent/10 px-2 py-1 rounded">
                      {agent.schedule}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
