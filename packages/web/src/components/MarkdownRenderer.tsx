import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "../lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  onImageClick?: (src: string) => void;
}

export function MarkdownRenderer({ content, className, onImageClick }: MarkdownRendererProps) {
  const components = useMemo(
    () => ({
      code({ node, inline, className: codeClassName, children, ...props }: any) {
        const match = /language-(\w+)/.exec(codeClassName || "");
        const language = match ? match[1] : "";

        if (!inline && language) {
          return (
            <div className="relative group">
              <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                  {language}
                </span>
              </div>
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={language}
                PreTag="div"
                className="rounded-lg my-3 !bg-[#1e1e1e] !p-4 text-sm overflow-x-auto"
                showLineNumbers={true}
                lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: '#6e7681' }}
                {...props}
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            </div>
          );
        }

        return (
          <code
            className="bg-secondary px-1.5 py-0.5 rounded text-sm font-mono text-foreground border border-border"
            {...props}
          >
            {children}
          </code>
        );
      },
      p({ children }: any) {
        return <p className="mb-3 leading-relaxed last:mb-0">{children}</p>;
      },
      ul({ children }: any) {
        return <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>;
      },
      ol({ children }: any) {
        return <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>;
      },
      li({ children }: any) {
        return <li className="leading-relaxed">{children}</li>;
      },
      h1({ children }: any) {
        return <h1 className="text-xl font-semibold mb-3 mt-4">{children}</h1>;
      },
      h2({ children }: any) {
        return <h2 className="text-lg font-semibold mb-2 mt-4">{children}</h2>;
      },
      h3({ children }: any) {
        return <h3 className="text-base font-semibold mb-2 mt-3">{children}</h3>;
      },
      a({ href, children }: any) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {children}
          </a>
        );
      },
      img({ src, alt }: any) {
        return (
          <img
            src={src}
            alt={alt}
            className="rounded-lg border border-border max-w-full cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => src && onImageClick?.(src)}
          />
        );
      },
      table({ children }: any) {
        return (
          <div className="overflow-x-auto mb-3">
            <table className="min-w-full border border-border rounded-lg">
              {children}
            </table>
          </div>
        );
      },
      thead({ children }: any) {
        return <thead className="bg-accent/50">{children}</thead>;
      },
      th({ children }: any) {
        return (
          <th className="px-3 py-2 text-left text-sm font-semibold border-b border-border">
            {children}
          </th>
        );
      },
      td({ children }: any) {
        return (
          <td className="px-3 py-2 text-sm border-b border-border">
            {children}
          </td>
        );
      },
      blockquote({ children }: any) {
        return (
          <blockquote className="border-l-4 border-primary pl-4 py-1 my-3 bg-accent/30 rounded-r">
            {children}
          </blockquote>
        );
      },
      hr() {
        return <hr className="my-4 border-border" />;
      },
    }),
    [onImageClick]
  );

  // Clean up content - remove tool call artifacts
  const cleanedContent = content
    .replace(/<\|tool_calls_section_begin\|>/g, "")
    .replace(/<\|tool_calls_section_end\|>/g, "")
    .replace(/<\|tool_call_begin\|>/g, "")
    .replace(/<\|tool_call_end\|>/g, "")
    .replace(/<\|tool_call_argument_begin\|>/g, "")
    .replace(/<\|tool_call_argument_end\|>/g, "")
    .replace(/<function=[^>]*>/g, "")
    .replace(/functions\.[a-z_]+/g, "");

  return (
    <div className={cn("prose prose-sm max-w-none", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {cleanedContent}
      </ReactMarkdown>
    </div>
  );
}
