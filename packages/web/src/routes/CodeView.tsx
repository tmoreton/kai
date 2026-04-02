import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Plus, Folder, MessageSquare, Clock } from "lucide-react";
import { projectsQueries } from "../api/queries";
import { timeAgo } from "../lib/utils";
import type { Project } from "../types/api";

export function CodeView() {
  const { data: projects } = useSuspenseQuery(projectsQueries.list());
  const [showCreate, setShowCreate] = useState(false);
  const [newPath, setNewPath] = useState("");

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-foreground">Code Projects</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg hover:bg-foreground/90 text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>

        {showCreate && (
          <div className="mb-6 p-4 bg-card border border-border rounded-xl">
            <h3 className="font-medium text-foreground mb-3">Create New Project</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="/path/to/project"
                className="flex-1 px-3 py-2 bg-secondary border border-border rounded-lg text-sm outline-none focus:border-primary"
              />
              <button
                onClick={() => {}}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium"
              >
                Create
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 border border-border rounded-lg hover:bg-accent/50 text-sm"
              >
                Cancel
              </button>
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
  return (
    <div className="bg-card border border-border rounded-xl p-5 hover:border-primary transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-foreground text-lg">{project.name}</h3>
          <p className="text-sm text-muted-foreground font-mono mt-1">{project.cwd}</p>
        </div>
        <div className="text-sm text-muted-foreground">
          {project.sessionCount} sessions
        </div>
      </div>

      <div className="space-y-2">
        {project.sessions.slice(0, 5).map((session) => (
          <a
            key={session.id}
            href={`/chat/${session.id}`}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50 transition-colors group"
          >
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
            <span className="flex-1 text-sm text-muted-foreground truncate">
              {session.preview || "No preview"}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo(session.updatedAt)}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
