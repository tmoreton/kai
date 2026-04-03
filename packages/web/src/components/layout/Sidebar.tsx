import { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation, Link } from "react-router-dom";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Bot,
  Code,
  Settings,
  Bell,
  BookOpen,
  Plus,
  ChevronDown,
  PanelLeftClose,
  X,
  GitBranch,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { sessionsQueries, agentsQueries } from "../../api/queries";
import { api } from "../../api/client";
import { useAppStore } from "../../stores/appStore";
import { formatShortDate } from "../../lib/utils";
import { useMobile } from "../../hooks/useMobile";
import type { Session, Persona } from "../../types/api";

interface SidebarSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: {
    icon: React.ReactNode;
    onClick: () => void;
    title: string;
  };
  defaultCollapsed?: boolean;
}

function SidebarSection({ title, icon, children, action, defaultCollapsed = true }: SidebarSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className={cn("mb-2", collapsed && "collapsed")}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:bg-accent/50 rounded-lg transition-colors"
      >
        <span className="flex items-center gap-2 flex-1 text-left">
          {icon}
          {title}
        </span>
        {action && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
            title={action.title}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-primary"
          >
            {action.icon}
          </button>
        )}
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform duration-200",
            collapsed && "-rotate-90"
          )}
        />
      </button>
      {!collapsed && <div className="mt-1 ml-3 pl-3 border-l border-border space-y-0.5">{children}</div>}
    </div>
  );
}

interface SidebarItemProps {
  to?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  label: string;
  active?: boolean;
  meta?: React.ReactNode;
  onDelete?: () => void;
}

function SidebarItem({ to, onClick, icon, label, active, meta, onDelete }: SidebarItemProps) {
  const content = (
    <>
      {icon && <span className="w-5 flex-shrink-0">{icon}</span>}
      <span className="flex-1 truncate text-left">{label}</span>
      {meta && (
        <span className="text-xs text-muted-foreground flex-shrink-0 group-hover:hidden">
          {meta}
        </span>
      )}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onDelete();
          }}
          className="hidden group-hover:flex p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
        >
          ×
        </button>
      )}
    </>
  );

  const className = cn(
    "flex items-center gap-2 px-2 py-1.5 text-[13px] rounded-lg transition-colors group",
    active
      ? "bg-accent/80 text-foreground font-medium"
      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button onClick={onClick} className={className}>
      {content}
    </button>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { sessionId, personaId } = useParams();
  const { sidebarCollapsed, toggleSidebar, sidebarOpen: mobileOpen, setSidebarOpen } = useAppStore();
  const isMobile = useMobile();
  const setMobileOpen = setSidebarOpen;

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    if (mobileOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [mobileOpen]);

  // Fetch data
  const { data: sessions } = useSuspenseQuery(sessionsQueries.list());
  const { data: agentsData } = useSuspenseQuery(agentsQueries.list());
  const { data: projects } = useSuspenseQuery(sessionsQueries.list('code'));

  const chatSessions = sessions.filter((s: Session) => s.type === 'chat');
  const { personas } = agentsData;

  const isActive = (path: string) => location.pathname.startsWith(path);

  const handleNewChat = () => {
    navigate('/chat');
    setMobileOpen(false);
  };

  const handleNewAgent = () => {
    navigate('/agents/persona/new');
    setMobileOpen(false);
  };

  const handleNewProject = () => {
    navigate('/code', { state: { create: true } });
    setMobileOpen(false);
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm('Delete this chat? This cannot be undone.')) return;
    try {
      await api.sessions.delete(id);
      queryClient.invalidateQueries({ queryKey: sessionsQueries.all() });
      if (sessionId === id) {
        navigate('/chat');
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  // Mobile collapsed state - no rail, just render nothing
  // The mobile header with hamburger is rendered in RootLayout
  if (isMobile && !mobileOpen) {
    return null;
  }

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex-1" />
        <div className="flex items-center gap-2 font-bold text-lg text-foreground">
          <svg
            viewBox="0 0 32 32"
            className="w-7 h-7"
          >
            <defs>
              <linearGradient id="kai-logo" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#0D9488" />
                <stop offset="100%" stopColor="#115E59" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="url(#kai-logo)" />
            <path
              d="M9 8v16M9 16l8-8M9 16l8 8"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          Kai
        </div>
        <div className="flex-1 flex justify-end">
          <button
            onClick={() => isMobile ? setMobileOpen(false) : toggleSidebar()}
            className="p-1.5 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground"
            title={isMobile ? "Close menu" : "Collapse sidebar"}
          >
            {isMobile ? <X className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {/* Chat Section */}
        <SidebarSection
          title="Chat"
          icon={<MessageSquare className="w-4 h-4" />}
          action={{
            icon: <Plus className="w-4 h-4" />,
            onClick: handleNewChat,
            title: "New Chat",
          }}
          defaultCollapsed={false}
        >
          {chatSessions.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">No chats yet</div>
          ) : (
            chatSessions.slice(0, 20).map((session: Session) => (
              <SidebarItem
                key={session.id}
                to={`/chat/${session.id}`}
                label={session.preview || session.name || 'New chat'}
                active={sessionId === session.id}
                meta={formatShortDate(session.updatedAt)}
                onDelete={() => handleDeleteSession(session.id)}
              />
            ))
          )}
        </SidebarSection>

        {/* Personas Section */}
        <SidebarSection
          title="Personas"
          icon={<Bot className="w-4 h-4" />}
          action={{
            icon: <Plus className="w-4 h-4" />,
            onClick: handleNewAgent,
            title: "New Persona",
          }}
        >
          {personas.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">No personas yet</div>
          ) : (
            personas.map((persona: Persona) => (
              <SidebarItem
                key={persona.id}
                to={`/agents/${persona.id}`}
                label={persona.name}
                active={personaId === persona.id}
              />
            ))
          )}
        </SidebarSection>

        {/* Code Section - Grouped by Project */}
        <SidebarSection
          title="Code"
          icon={<Code className="w-4 h-4" />}
          action={{
            icon: <Plus className="w-4 h-4" />,
            onClick: handleNewProject,
            title: "New Project",
          }}
        >
          {projects.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">No projects yet</div>
          ) : (
            (() => {
              // Group sessions by project (cwd)
              const grouped = projects.reduce((acc, session) => {
                const projectPath = session.cwd || 'Unknown';
                const projectName = projectPath.split('/').pop() || projectPath;
                if (!acc[projectPath]) {
                  acc[projectPath] = { name: projectName, sessions: [] };
                }
                acc[projectPath].sessions.push(session);
                return acc;
              }, {} as Record<string, { name: string; sessions: Session[] }>);

              return Object.entries(grouped).map(([path, { name, sessions }]) => (
                <div key={path} className="mb-2">
                  {/* Project Header */}
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    <span className="w-4 h-4">📁</span>
                    <span className="truncate">{name}</span>
                  </div>
                  {/* Sessions under this project */}
                  <div className="ml-4 space-y-0.5 border-l border-border pl-2">
                    {sessions.slice(0, 5).map((session: Session) => (
                      <SidebarItem
                        key={session.id}
                        to={`/chat/${session.id}`}
                        icon={<Code className="w-3.5 h-3.5" />}
                        label={session.preview || session.name || 'Code session'}
                        active={sessionId === session.id}
                        meta={formatShortDate(session.updatedAt)}
                      />
                    ))}
                    {sessions.length > 5 && (
                      <div className="px-2 py-1 text-xs text-muted-foreground">
                        +{sessions.length - 5} more...
                      </div>
                    )}
                  </div>
                </div>
              ));
            })()
          )}
        </SidebarSection>

        {/* Static sections */}
        <SidebarItem
          to="/workflows"
          icon={<GitBranch className="w-4 h-4" />}
          label="Workflows"
          active={isActive('/workflows')}
        />
        <SidebarItem
          to="/docs"
          icon={<BookOpen className="w-4 h-4" />}
          label="Docs"
          active={isActive('/docs')}
        />
        <SidebarItem
          to="/settings"
          icon={<Settings className="w-4 h-4" />}
          label="Settings"
          active={isActive('/settings')}
        />
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2">
          <Link
            to="/notifications"
            className={cn(
              "flex items-center justify-center w-10 h-10 rounded-lg transition-colors",
              isActive('/notifications')
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <Bell className="w-5 h-5" />
          </Link>
        </div>
      </div>
    </>
  );

  // Mobile overlay sidebar
  if (isMobile && mobileOpen) {
    return (
      <>
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
        {/* Mobile Sidebar */}
        <aside className="fixed top-0 left-0 bottom-0 w-64 z-50 flex flex-col bg-secondary border-r border-border shadow-xl">
          {sidebarContent}
        </aside>
      </>
    );
  }

  // Desktop sidebar collapsed - no rail, AppHeader handles expand
  if (sidebarCollapsed) {
    return null;
  }

  // Desktop sidebar expanded
  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-secondary border-r border-border">
      {sidebarContent}
    </aside>
  );
}
