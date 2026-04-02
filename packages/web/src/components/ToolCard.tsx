import { useState } from "react";
import { ChevronRight, Check, X, Loader2, FileEdit, Terminal, Search, Image, Globe } from "lucide-react";
import { cn, truncate } from "../lib/utils";
import type { ToolCallWithStatus } from "../types/api";

interface ToolCardProps {
  tool: ToolCallWithStatus;
  onToggle?: () => void;
}

const toolIcons: Record<string, React.ReactNode> = {
  read_file: <Terminal className="w-4 h-4" />,
  write_file: <FileEdit className="w-4 h-4" />,
  edit_file: <FileEdit className="w-4 h-4" />,
  bash: <Terminal className="w-4 h-4" />,
  web_search: <Search className="w-4 h-4" />,
  web_fetch: <Globe className="w-4 h-4" />,
  generate_image: <Image className="w-4 h-4" />,
};

function getToolIcon(name: string) {
  for (const [prefix, icon] of Object.entries(toolIcons)) {
    if (name.includes(prefix)) return icon;
  }
  return <Terminal className="w-4 h-4" />;
}

function summarizeArgs(name: string, args: string): string {
  try {
    const parsed = JSON.parse(args);
    if (name.includes("read_file") || name.includes("write_file") || name.includes("edit_file")) {
      const path = parsed.file_path || parsed.path || "file";
      return path.split("/").pop() || path;
    }
    if (name.includes("bash")) {
      return truncate(parsed.command || "cmd", 40);
    }
    if (name.includes("web_search")) {
      return truncate(parsed.query || "search", 40);
    }
    return truncate(JSON.stringify(parsed), 40);
  } catch {
    return truncate(args, 40);
  }
}

export function ToolCard({ tool, onToggle }: ToolCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const statusIcon = {
    running: <Loader2 className="w-4 h-4 animate-spin text-primary" />,
    done: <Check className="w-4 h-4 text-green-500" />,
    error: <X className="w-4 h-4 text-destructive" />,
  }[tool.status];

  const statusColor = {
    running: "border-primary/50 bg-primary/5",
    done: "border-border",
    error: "border-destructive/50 bg-destructive/5",
  }[tool.status];

  // Get name from tool.function.name or fallback to tool.id
  const toolName = tool.function?.name || 'unknown';

  return (
    <div
      className={cn(
        "border rounded-lg overflow-hidden mb-3",
        statusColor,
        isOpen && "shadow-sm"
      )}
    >
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          onToggle?.();
        }}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-black/5 transition-colors"
      >
        <span className="flex-shrink-0">{statusIcon}</span>
        <span className="flex-shrink-0 text-muted-foreground">{getToolIcon(toolName)}</span>
        <span className="font-medium text-sm text-foreground">{toolName}</span>
        <span className="text-sm text-muted-foreground truncate flex-1">
          {summarizeArgs(toolName, tool.args)}
        </span>
        <ChevronRight
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform",
            isOpen && "rotate-90"
          )}
        />
      </button>

      {isOpen && (
        <div className="border-t border-border/50 bg-secondary/50">
          {/* Arguments */}
          <div className="px-3 py-2">
            <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
              Arguments
            </div>
            <pre className="text-xs bg-secondary p-2.5 rounded overflow-auto max-h-32 font-mono">
              {tool.args}
            </pre>
          </div>

          {/* Result */}
          {tool.result && (
            <div className="px-3 py-2 border-t border-border/50">
              <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                Result
              </div>
              <pre
                className={cn(
                  "text-xs p-2.5 rounded overflow-auto max-h-48 font-mono",
                  tool.error
                    ? "bg-destructive/10 text-destructive"
                    : "bg-secondary text-muted-foreground"
                )}
              >
                {tool.result}
              </pre>
            </div>
          )}

          {/* Diff */}
          {tool.diff && (
            <div className="px-3 py-2 border-t border-border/50">
              <div className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                Changes
              </div>
              <pre className="text-xs bg-secondary p-2.5 rounded overflow-auto max-h-48 font-mono whitespace-pre-wrap">
                {tool.diff}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
