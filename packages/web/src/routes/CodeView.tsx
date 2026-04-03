import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Folder, MessageSquare, Clock } from "lucide-react";
import { projectsQueries } from "../api/queries";
import { api } from "../api/client";
import { timeAgo } from "../lib/utils";
import { toast } from "../components/Toast";
import { Button } from "../components/ui/button";
import type { Project } from "../types/api";

export function CodeView() {
  const queryClient = useQueryClient();
  const { data: projects } = useSuspenseQuery(projectsQueries.list());
  const [showCreate, setShowCreate] = useState(false);
  const [newPath, setNewPath] = useState("");

  const createMutation = useMutation({
    mutationFn: api.projects.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectsQueries.all() });
      setShowCreate(false);
      setNewPath("");
      toast.success("Project created successfully");
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Failed to create project";
      toast.error("Error", message);
    },
  });

  const handleCreate = () => {
    if (!newPath.trim()) {
      toast.error("Error", "Please enter a project path");
      return;
    }
    createMutation.mutate(newPath.trim());
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Code Projects</h1>
          <Button
            onClick={() => setShowCreate(true)}
            variant="default"
          >
            <Plus className="w-4 h-4" />
            New Project
          </Button>
        </div>

        {showCreate && (
          <div className="mb-6 p-4 bg-card border border-border rounded-xl">
            <h3 className="font-medium text-foreground mb-3">Create New Project</h3>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="/path/to/project"
                className="flex-1 px-3 py-2 bg-secondary border border-border rounded-lg text-sm outline-none focus:border-primary"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  variant="default"
                  className="flex-1 sm:flex-none whitespace-nowrap"
                >
                  {createMutation.isPending ? "Creating..." : "Create"}
                </Button>
                <Button
                  onClick={() => setShowCreate(false)}
                  variant="outline"
                  className="flex-1 sm:flex-none whitespace-nowrap"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {projects.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Folder className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p>No projects yet. Create your first one!</p>
            </div>
          ) : (
            projects.map((project: Project) => (
              <ProjectCard key={project.cwd} project={project} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const createSession = useMutation({
    mutationFn: () => api.sessions.create({ type: "code", cwd: project.cwd }),
    onSuccess: (session) => {
      navigate(`/chat/${session.id}`);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Failed to create session";
      toast.error("Error", message);
    },
  });

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5 hover:border-primary transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground text-base sm:text-lg">{project.name}</h3>
          <p className="text-xs sm:text-sm text-muted-foreground font-mono mt-1 truncate">{project.cwd}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm text-muted-foreground">
            {project.sessionCount} sessions
          </span>
          <Button
            onClick={() => createSession.mutate()}
            disabled={createSession.isPending}
            variant="ghost"
            size="icon"
            title="New session"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {project.sessions.slice(0, 5).map((session) => (
          <a
            key={session.id}
            href={`/chat/${session.id}`}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50 transition-colors group"
          >
            <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="flex-1 text-xs sm:text-sm text-muted-foreground truncate">
              {session.preview || "No preview"}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
              <Clock className="w-3 h-3" />
              <span className="hidden sm:inline">{timeAgo(session.updatedAt)}</span>
              <span className="sm:hidden">{timeAgo(session.updatedAt).replace(/\sago/, "")}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
