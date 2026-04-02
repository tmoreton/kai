export function DocsView() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold text-foreground mb-4">What can Kai do?</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Your AI assistant that can chat, search the web, generate images, run automated tasks, and connect to your tools.
        </p>

        <div className="prose prose-slate max-w-none">
          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-3">Chat</h2>
            <p className="text-muted-foreground">
              Just type what you need. Kai understands natural language and figures out which tools to use —
              including reading and writing files on your computer.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-3">Web Search</h2>
            <p className="text-muted-foreground">
              Kai can search the web and read web pages. Requires a Tavily API key for search.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-3">Images</h2>
            <p className="text-muted-foreground">
              Generate images from text descriptions. Great for thumbnails, social posts, and concept art.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-3">Agents</h2>
            <p className="text-muted-foreground">
              Automated workflows that run on a schedule. Monitor competitors, research trends, generate ideas — all on autopilot.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-3">Skills & MCP</h2>
            <p className="text-muted-foreground">
              Extend Kai by connecting external tools. Skills are simple JavaScript plugins, while MCP servers follow the open Model Context Protocol standard.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
