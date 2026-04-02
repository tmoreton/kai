import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { cn } from "../lib/utils";

const SLASH_COMMANDS = [
  { cmd: "/help", desc: "Show all commands", category: "Session" },
  { cmd: "/clear", desc: "Clear conversation", category: "Session" },
  { cmd: "/compact", desc: "Compress context to save tokens", category: "Session" },
  { cmd: "/cost", desc: "Token usage + context breakdown", category: "Session" },
  { cmd: "/sessions", desc: "List recent sessions", category: "Session" },
  { cmd: "/soul", desc: "View core memory + recall stats", category: "Session" },
  { cmd: "/export", desc: "Export session to markdown", category: "Session" },
  { cmd: "/git", desc: "Git status + changed files", category: "Git" },
  { cmd: "/git diff", desc: "Colorized diff", category: "Git" },
  { cmd: "/git log", desc: "Recent commits", category: "Git" },
  { cmd: "/git commit", desc: "AI-generated commit", category: "Git" },
  { cmd: "/git pr", desc: "Create PR", category: "Git" },
  { cmd: "/git branch", desc: "Branch management", category: "Git" },
  { cmd: "/git undo", desc: "Undo commits + reset", category: "Git" },
  { cmd: "/git stash", desc: "Stash uncommitted changes", category: "Git" },
  { cmd: "/agent", desc: "List background agents", category: "Agents" },
  { cmd: "/agent run", desc: "Run agent", category: "Agents" },
  { cmd: "/agent output", desc: "View agent output", category: "Agents" },
  { cmd: "/agent info", desc: "Agent details + history", category: "Agents" },
  { cmd: "/notify", desc: "Agent notifications digest", category: "Agents" },
  { cmd: "/review", desc: "Code review current changes", category: "Code Quality" },
  { cmd: "/security-review", desc: "Security audit", category: "Code Quality" },
  { cmd: "/plan", desc: "Toggle plan mode (read-only)", category: "Code Quality" },
  { cmd: "/diff", desc: "Changes made this session", category: "Code Quality" },
  { cmd: "/doctor", desc: "System diagnostics", category: "System" },
  { cmd: "/skill", desc: "List installed skills", category: "System" },
  { cmd: "/skill reload", desc: "Hot-reload all skills", category: "System" },
  { cmd: "/mcp", desc: "List MCP servers + tools", category: "System" },
  { cmd: "/errors", desc: "View tracked errors", category: "System" },
];

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useAppStore();
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = filter
    ? SLASH_COMMANDS.filter(
        (c) =>
          c.cmd.toLowerCase().includes(filter.toLowerCase()) ||
          c.desc.toLowerCase().includes(filter.toLowerCase())
      )
    : SLASH_COMMANDS;

  const byCategory = filtered.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, typeof SLASH_COMMANDS>);

  useEffect(() => {
    if (commandPaletteOpen) {
      setFilter("");
      setSelectedIndex(0);
      inputRef.current?.focus();
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      if (e.key === "Escape" && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selectedIndex];
      if (cmd) {
        selectCommand(cmd.cmd);
      }
    }
  };

  const selectCommand = (cmd: string) => {
    // Insert command into chat input and close palette
    const input = document.querySelector('textarea[placeholder*="help"]') as HTMLTextAreaElement;
    if (input) {
      input.value = cmd + " ";
      input.focus();
    }
    setCommandPaletteOpen(false);
  };

  if (!commandPaletteOpen) return null;

  let flatIndex = 0;

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-start justify-center pt-32 z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) setCommandPaletteOpen(false);
      }}
    >
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        <div className="p-3 border-b border-border">
          <input
            ref={inputRef}
            type="text"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="w-full px-3 py-2 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-muted-foreground">No commands found</div>
          ) : (
            Object.entries(byCategory).map(([category, commands]) => (
              <div key={category}>
                <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {category}
                </div>
                {commands.map((cmd) => {
                  const isSelected = flatIndex === selectedIndex;
                  const currentIndex = flatIndex++;
                  return (
                    <button
                      key={cmd.cmd}
                      onClick={() => selectCommand(cmd.cmd)}
                      className={cn(
                        "w-full px-4 py-2 flex items-center gap-3 text-left transition-colors",
                        isSelected ? "bg-accent/50" : "hover:bg-accent/30"
                      )}
                      onMouseEnter={() => setSelectedIndex(currentIndex)}
                    >
                      <span className="font-mono text-sm text-primary">{cmd.cmd}</span>
                      <span className="text-sm text-muted-foreground">{cmd.desc}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground flex items-center gap-4">
          <span>↑↓ to navigate</span>
          <span>↵ to select</span>
          <span>esc to close</span>
          <span className="ml-auto">⌘K to open</span>
        </div>
      </div>
    </div>
  );
}
