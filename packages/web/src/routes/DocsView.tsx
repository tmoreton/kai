import { useState } from "react";
import { Terminal, Monitor, ChevronDown, ChevronRight, Zap, Bot, Brain, GitBranch, Globe, Image, Shield, Wrench, MessageSquare, FolderCode, Puzzle, Server } from "lucide-react";
import { cn } from "../lib/utils";

type ViewMode = "all" | "ui" | "cli";

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "ui" | "cli" | "both" }) {
  const colors = {
    default: "bg-muted text-muted-foreground",
    ui: "bg-blue-500/10 text-blue-500 border border-blue-500/20",
    cli: "bg-amber-500/10 text-amber-500 border border-amber-500/20",
    both: "bg-kai-teal/10 text-kai-teal border border-kai-teal/20",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider", colors[variant])}>
      {children}
    </span>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-kai-bg rounded-lg p-3 text-sm font-mono text-kai-text overflow-x-auto border border-border">
      <code>{children}</code>
    </pre>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="px-1.5 py-0.5 bg-kai-bg rounded text-xs font-mono text-primary border border-border">{children}</code>;
}

function Section({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full px-5 py-4 text-left hover:bg-accent/30 transition-colors"
      >
        <span className="text-primary">{icon}</span>
        <span className="flex-1 font-semibold text-kai-text">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">{children}</div>}
    </div>
  );
}

function FeatureRow({
  name,
  description,
  availability,
  cli,
  viewMode,
}: {
  name: string;
  description: string;
  availability: "ui" | "cli" | "both";
  cli?: string;
  viewMode: ViewMode;
}) {
  if (viewMode === "ui" && availability === "cli") return null;
  if (viewMode === "cli" && availability === "ui") return null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 py-3 border-b border-border/50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-kai-text text-sm">{name}</span>
          <Badge variant={availability}>{availability === "both" ? "UI + CLI" : availability}</Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      {cli && (availability === "cli" || availability === "both") && (viewMode !== "ui") && (
        <div className="flex-shrink-0">
          <code className="text-xs font-mono bg-kai-bg px-2 py-1 rounded border border-border text-muted-foreground">{cli}</code>
        </div>
      )}
    </div>
  );
}

export function DocsView() {
  const [viewMode, setViewMode] = useState<ViewMode>("all");

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-kai-text mb-2">Documentation</h1>
          <p className="text-muted-foreground text-lg">
            Everything Kai can do — from your browser or your terminal.
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2 mb-6 p-1 bg-kai-bg rounded-lg w-fit border border-border">
          <button
            onClick={() => setViewMode("all")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
              viewMode === "all" ? "bg-card text-kai-text shadow-sm" : "text-muted-foreground hover:text-kai-text"
            )}
          >
            <Zap className="w-4 h-4" />
            All
          </button>
          <button
            onClick={() => setViewMode("ui")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
              viewMode === "ui" ? "bg-card text-kai-text shadow-sm" : "text-muted-foreground hover:text-kai-text"
            )}
          >
            <Monitor className="w-4 h-4" />
            Web UI
          </button>
          <button
            onClick={() => setViewMode("cli")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
              viewMode === "cli" ? "bg-card text-kai-text shadow-sm" : "text-muted-foreground hover:text-kai-text"
            )}
          >
            <Terminal className="w-4 h-4" />
            CLI
          </button>
        </div>

        {/* Quick Start */}
        <div className="bg-gradient-to-br from-kai-teal/5 to-transparent border border-kai-teal/20 rounded-xl p-5 mb-8">
          <h2 className="font-semibold text-kai-text mb-3">Quick Start</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {viewMode !== "cli" && (
              <div>
                <p className="text-sm font-medium text-kai-text mb-1.5 flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-blue-500" /> Web UI
                </p>
                <CodeBlock>{`kai start\n# Opens at http://localhost:3141`}</CodeBlock>
              </div>
            )}
            {viewMode !== "ui" && (
              <div>
                <p className="text-sm font-medium text-kai-text mb-1.5 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-amber-500" /> CLI
                </p>
                <CodeBlock>{`kai              # Interactive REPL\nkai "fix the bug" # Start with a prompt`}</CodeBlock>
              </div>
            )}
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-3">

          {/* Chat & Conversations */}
          <Section title="Chat & Conversations" icon={<MessageSquare className="w-5 h-5" />} defaultOpen={true}>
            <p className="text-sm text-muted-foreground">
              Have natural conversations with Kai. Ask questions, get code written, debug issues, or brainstorm ideas.
            </p>
            <div className="divide-y divide-border/50">
              <FeatureRow viewMode={viewMode} name="Real-time Streaming" description="Responses stream token-by-token as they're generated." availability="both" />
              <FeatureRow viewMode={viewMode} name="File Attachments" description="Attach images, code files, CSVs, and more to your messages." availability="ui" />
              <FeatureRow viewMode={viewMode} name="Voice Input" description="Dictate messages with speech-to-text transcription." availability="ui" />
              <FeatureRow viewMode={viewMode} name="Session Persistence" description="Conversations are saved automatically. Resume anytime." availability="both" cli="kai --resume <id>" />
              <FeatureRow viewMode={viewMode} name="Export to Markdown" description="Download any conversation as a .md file." availability="both" cli="/export" />
              <FeatureRow viewMode={viewMode} name="Context Compaction" description="Compress long conversations to stay within token limits." availability="both" cli="/compact" />
              <FeatureRow viewMode={viewMode} name="Piped Input" description="Pipe content from other commands directly into Kai." availability="cli" cli={`echo "explain this" | kai`} />
              <FeatureRow viewMode={viewMode} name="Command Palette" description="Quick access to all slash commands with Cmd+K." availability="ui" />
            </div>
          </Section>

          {/* Tools & Code */}
          <Section title="Tools & Code Execution" icon={<Wrench className="w-5 h-5" />}>
            <p className="text-sm text-muted-foreground">
              Kai can read, write, and edit files, run shell commands, and search your codebase — all with your approval.
            </p>
            <div className="divide-y divide-border/50">
              <FeatureRow viewMode={viewMode} name="Read Files" description="Read any file including text, PDF, DOCX, XLSX, CSV, and images." availability="both" />
              <FeatureRow viewMode={viewMode} name="Write & Edit Files" description="Create new files or make targeted find-and-replace edits." availability="both" />
              <FeatureRow viewMode={viewMode} name="Shell Commands" description="Execute bash commands with configurable timeouts." availability="both" />
              <FeatureRow viewMode={viewMode} name="Background Processes" description="Start long-running processes (dev servers, watchers) that persist." availability="both" />
              <FeatureRow viewMode={viewMode} name="File Search (Glob)" description="Find files using glob patterns across your project." availability="both" />
              <FeatureRow viewMode={viewMode} name="Content Search (Grep)" description="Search file contents with regex, with context lines." availability="both" />
              <FeatureRow viewMode={viewMode} name="Tool Execution UI" description="See running tools, their arguments, results, and diffs in real time." availability="ui" />
              <FeatureRow viewMode={viewMode} name="Permission System" description="Approve or deny tool calls. Auto-approve mode available." availability="both" cli="kai -y" />
            </div>
          </Section>

          {/* Git Integration */}
          <Section title="Git Integration" icon={<GitBranch className="w-5 h-5" />}>
            <p className="text-sm text-muted-foreground">
              Built-in git workflows — from viewing diffs to creating PRs — all without leaving Kai.
            </p>
            <div className="divide-y divide-border/50">
              <FeatureRow viewMode={viewMode} name="Status & Diff" description="View modified files and colorized diffs." availability="both" cli="/git diff" />
              <FeatureRow viewMode={viewMode} name="Commit Log" description="Browse recent commit history." availability="both" cli="/git log" />
              <FeatureRow viewMode={viewMode} name="AI Commit" description="Auto-generate commit messages from your changes." availability="both" cli="/git commit" />
              <FeatureRow viewMode={viewMode} name="Create PR" description="Branch, commit, push, and open a pull request in one command." availability="both" cli="/git pr" />
              <FeatureRow viewMode={viewMode} name="Branch Management" description="List, create, and switch branches." availability="both" cli="/git branch" />
              <FeatureRow viewMode={viewMode} name="Undo Commits" description="Soft-reset recent commits with conversation cleanup." availability="both" cli="/git undo" />
              <FeatureRow viewMode={viewMode} name="Stash" description="Stash and restore uncommitted changes." availability="both" cli="/git stash" />
              <FeatureRow viewMode={viewMode} name="Code Review" description="AI-powered review of your current changes." availability="both" cli="/review" />
              <FeatureRow viewMode={viewMode} name="Security Review" description="Security-focused audit of your changes." availability="both" cli="/security-review" />
            </div>
          </Section>

          {/* Agents & Personas */}
          <Section title="Agents & Personas" icon={<Bot className="w-5 h-5" />}>
            <p className="text-sm text-muted-foreground">
              Create specialized AI personas with unique identities. Run automated workflows on schedules or on-demand.
            </p>
            <div className="divide-y divide-border/50">
              <FeatureRow viewMode={viewMode} name="Create Personas" description="Define name, role, personality, goals, and allowed tools." availability="both" cli="kai agent create" />
              <FeatureRow viewMode={viewMode} name="Persona Chat" description="Chat directly with a specific persona in its own session." availability="ui" />
              <FeatureRow viewMode={viewMode} name="Persona Editor" description="Rich editor with personality, goals, scratchpad, tool selection, and file uploads." availability="ui" />
              <FeatureRow viewMode={viewMode} name="YAML Workflows" description="Define multi-step agent workflows with LLM, shell, and integration steps." availability="both" cli="kai agent create <name> <file>" />
              <FeatureRow viewMode={viewMode} name="Cron Scheduling" description="Run agents automatically on a schedule." availability="both" cli={`-s "0 */6 * * *"`} />
              <FeatureRow viewMode={viewMode} name="Run On Demand" description="Trigger any agent immediately." availability="both" cli="kai agent run <id>" />
              <FeatureRow viewMode={viewMode} name="Execution History" description="View run history, step outputs, errors, and recaps." availability="both" cli="kai agent output <id>" />
              <FeatureRow viewMode={viewMode} name="Agent Daemon" description="Background process that manages scheduled agent execution." availability="both" cli="kai agent daemon" />
              <FeatureRow viewMode={viewMode} name="Spawn Sub-agents" description="Spawn explorer, planner, or worker agents for complex tasks." availability="both" />
              <FeatureRow viewMode={viewMode} name="Swarm Mode" description="Launch multiple agents in parallel with a shared scratchpad." availability="both" />
              <FeatureRow viewMode={viewMode} name="Heartbeat Triggers" description="Proactive agent triggers based on file changes, webhooks, or thresholds." availability="cli" cli="--heartbeat-condition" />
              <FeatureRow viewMode={viewMode} name="Notifications" description="Get notified when agents complete or fail." availability="both" cli="/notify" />
            </div>
          </Section>

          {/* Memory & Identity */}
          <Section title="Memory & Identity" icon={<Brain className="w-5 h-5" />}>
            <p className="text-sm text-muted-foreground">
              Kai remembers who it is, who you are, and what you're working on — across sessions.
            </p>
            <div className="divide-y divide-border/50">
              <FeatureRow viewMode={viewMode} name="Core Memory (Soul)" description="Persistent identity: persona definition, user preferences, goals, and scratchpad." availability="both" cli="/soul" />
              <FeatureRow viewMode={viewMode} name="Recall Memory" description="Search across past conversations and sessions." availability="both" />
              <FeatureRow viewMode={viewMode} name="Archival Memory" description="Long-term knowledge storage with tags and search." availability="both" />
              <FeatureRow viewMode={viewMode} name="Project Context" description="Per-project goals and scratchpad that scope to your current codebase." availability="both" />
              <FeatureRow viewMode={viewMode} name="Identity Editor" description="Edit Kai's personality, your profile, and project context visually." availability="ui" />
            </div>
          </Section>

          {/* Web & Search */}
          <Section title="Web & Search" icon={<Globe className="w-5 h-5" />}>
            <div className="divide-y divide-border/50">
              <FeatureRow viewMode={viewMode} name="Web Search" description="Search the web for up-to-date information using Tavily." availability="both" />
              <FeatureRow viewMode={viewMode} name="Web Fetch" description="Fetch and read any URL, with HTML-to-text conversion." availability="both" />
              <FeatureRow viewMode={viewMode} name="Screenshot Capture" description="Take screenshots of your screen for visual context (macOS)." availability="both" />
            </div>
          </Section>

          {/* Image & Vision */}
          <Section title="Image & Vision" icon={<Image className="w-5 h-5" />}>
            <div className="divide-y divide-border/50">
              <FeatureRow viewMode={viewMode} name="Image Analysis" description="Analyze images with vision models — describe, extract text, identify issues." availability="both" />
              <FeatureRow viewMode={viewMode} name="Image Generation" description="Generate images from text prompts via OpenRouter." availability="both" />
              <FeatureRow viewMode={viewMode} name="Image Lightbox" description="Click any image in chat to view full-screen." availability="ui" />
            </div>
          </Section>

          {/* Projects */}
          <Section title="Projects & Sessions" icon={<FolderCode className="w-5 h-5" />}>
            <div className="divide-y divide-border/50">
              <FeatureRow viewMode={viewMode} name="Project Organization" description="Sessions grouped by working directory for easy navigation." availability="ui" />
              <FeatureRow viewMode={viewMode} name="Session History" description="Browse and resume past conversations." availability="both" cli="/sessions" />
              <FeatureRow viewMode={viewMode} name="Session Naming" description="Name sessions for easy identification." availability="both" cli="kai -n my-session" />
              <FeatureRow viewMode={viewMode} name="Resume Session" description="Pick up exactly where you left off." availability="both" cli="kai --resume <id>" />
              <FeatureRow viewMode={viewMode} name="Session Export" description="Export any session to markdown." availability="both" cli="/export" />
            </div>
          </Section>

          {/* Extensibility */}
          <Section title="Extensibility" icon={<Puzzle className="w-5 h-5" />}>
            <p className="text-sm text-muted-foreground">
              Extend Kai with MCP servers, custom skills, and user-defined commands.
            </p>
            <div className="divide-y divide-border/50">
              <FeatureRow viewMode={viewMode} name="MCP Servers" description="Connect Model Context Protocol servers to add tools (GitHub, filesystem, Puppeteer, etc.)." availability="both" cli="/mcp add" />
              <FeatureRow viewMode={viewMode} name="Skills" description="Install skill packages from GitHub or npm with manifest + handler." availability="both" cli="kai skill install" />
              <FeatureRow viewMode={viewMode} name="Hot Reload" description="Reload all skills without restarting Kai." availability="both" cli="/skill reload" />
              <FeatureRow viewMode={viewMode} name="Custom Commands" description="Drop markdown files in .kai/commands/ to create your own slash commands." availability="cli" />
              <FeatureRow viewMode={viewMode} name="Hooks" description="Run shell commands before/after tool calls for custom validation or automation." availability="both" />
            </div>
          </Section>

          {/* Server & Deployment */}
          <Section title="Server & Deployment" icon={<Server className="w-5 h-5" />}>
            <div className="divide-y divide-border/50">
              <FeatureRow viewMode={viewMode} name="Web Server" description="Serves the web UI, REST API, and agent daemon." availability="both" cli="kai start" />
              <FeatureRow viewMode={viewMode} name="Desktop App" description="Native macOS app via Tauri — no browser needed." availability="ui" />
              <FeatureRow viewMode={viewMode} name="Install CLI from App" description="Add the kai command to your PATH from Settings." availability="ui" />
              <FeatureRow viewMode={viewMode} name="Tailscale Serve" description="Expose Kai to your tailnet for access from other devices." availability="cli" cli="kai start --tailscale" />
              <FeatureRow viewMode={viewMode} name="Tailscale Funnel" description="Expose Kai to the public internet." availability="cli" cli="kai start --funnel" />
              <FeatureRow viewMode={viewMode} name="API-only Mode" description="Run without the web UI — just the API and agents." availability="cli" cli="kai start --no-ui" />
              <FeatureRow viewMode={viewMode} name="System Diagnostics" description="Check Node.js, git, API keys, MCP servers, and disk usage." availability="both" cli="/doctor" />
            </div>
          </Section>

          {/* Configuration */}
          <Section title="Configuration" icon={<Shield className="w-5 h-5" />}>
            <p className="text-sm text-muted-foreground">
              Configuration lives in <InlineCode>~/.kai/</InlineCode> and project-level <InlineCode>.kai/</InlineCode> directories.
            </p>
            <div className="divide-y divide-border/50">
              <FeatureRow viewMode={viewMode} name="Environment Variables" description="Store API keys and secrets securely in ~/.kai/.env." availability="both" />
              <FeatureRow viewMode={viewMode} name="Settings UI" description="Visual configuration for MCP servers, skills, env vars, identity, and context." availability="ui" />
              <FeatureRow viewMode={viewMode} name="Project Profile" description="Add a KAI.md to your repo root for project-specific context." availability="both" />
              <FeatureRow viewMode={viewMode} name="Permission Rules" description="Define tool permission rules in settings.json." availability="both" />
              <FeatureRow viewMode={viewMode} name="Auto-approve Mode" description="Skip all permission prompts for unattended usage." availability="cli" cli="kai -y" />
              <FeatureRow viewMode={viewMode} name="Unleashed Mode" description="Remove turn limits and safety guards." availability="cli" cli="kai --yolo" />
            </div>
          </Section>

          {/* CLI Reference */}
          {viewMode !== "ui" && (
            <Section title="CLI Command Reference" icon={<Terminal className="w-5 h-5" />}>
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-kai-text mb-2">Main Commands</h4>
                  <CodeBlock>{`kai [prompt]                  # Interactive REPL
kai start                     # Start web server + agents
kai agent create <n> <file>   # Create agent from workflow
kai agent list                # List all agents
kai agent run <id>            # Run agent immediately
kai agent output <id>         # View agent output
kai agent daemon              # Start agent scheduler
kai skill list                # List installed skills
kai skill install <source>    # Install a skill
kai mcp list                  # List MCP servers`}</CodeBlock>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-kai-text mb-2">Flags</h4>
                  <CodeBlock>{`-c, --continue [id]    Resume most recent or specific session
-r, --resume [id]      Same as --continue
-n, --name <name>      Name the session
-y, --yes              Auto-approve all tool calls
--yolo                 Disable safety limits
--port <port>          Server port (default: 3141)
--tailscale            Expose to tailnet
--funnel               Expose to public internet
--no-ui                API + agents only
--no-agents            UI + API only`}</CodeBlock>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-kai-text mb-2">REPL Slash Commands</h4>
                  <CodeBlock>{`/help             Show all commands
/clear            Clear conversation
/compact          Compress context
/export [path]    Export to markdown
/sessions         List sessions
/soul             View core memory
/doctor           System diagnostics

/git              Git status
/git diff         View changes
/git log          Commit history
/git commit       AI commit
/git pr           Create pull request
/git branch       Branch management
/git undo         Undo commits
/git stash        Stash changes

/review           Code review
/security-review  Security audit
/diff             Session changes
/plan             Toggle plan mode

/agent            List agents
/agent run <id>   Run agent
/notify           Notifications

/skill            List skills
/skill reload     Hot-reload skills
/mcp              List MCP servers
/errors           View errors`}</CodeBlock>
                </div>
              </div>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 pb-8 text-center text-sm text-muted-foreground">
          <p>
            Install the CLI: <InlineCode>npm install -g kai-ai</InlineCode>{" "}
            or use Settings &rarr; CLI in the desktop app.
          </p>
        </div>
      </div>
    </div>
  );
}
