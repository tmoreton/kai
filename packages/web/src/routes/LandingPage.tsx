import { useEffect, useState } from "react";
import { 
  Brain, 
  MemoryStick, 
  Bot, 
  Terminal, 
  Globe, 
  Image, 
  GitBranch, 
  Workflow, 
  Cpu,
  Zap,
  Download,
  Check,
  ArrowRight,
  Sparkles,
  Lock,
  Clock,
  Command
} from "lucide-react";

// GitHub icon component
const GithubIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" className={className}>
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
  </svg>
);

// Twitter/X icon component
const TwitterIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

// YouTube icon component
const YoutubeIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" className={className}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

// Get the latest release DMG URL from GitHub
const GITHUB_REPO = "tmoreton/kai";
const LATEST_RELEASE_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

interface DownloadInfo {
  version: string | null;
  aarch64Url: string | null;
  x86_64Url: string | null;
  loading: boolean;
  error: string | null;
}

export function LandingPage() {
  const [downloadInfo, setDownloadInfo] = useState<DownloadInfo>({
    version: null,
    aarch64Url: null,
    x86_64Url: null,
    loading: true,
    error: null,
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Fetch latest release info
    const fetchRelease = async () => {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
        );
        
        if (!response.ok) {
          // Fall back to hardcoded version
          setDownloadInfo({
            version: "v1.0.0",
            aarch64Url: `${LATEST_RELEASE_URL}/download/Kai-aarch64.dmg`,
            x86_64Url: `${LATEST_RELEASE_URL}/download/Kai-x86_64.dmg`,
            loading: false,
            error: null,
          });
          return;
        }

        const release = await response.json();
        const version = release.tag_name;
        
        // Find the DMG assets
        const aarch64Asset = release.assets.find((a: any) => 
          a.name.includes("aarch64") || a.name.includes("arm64")
        );
        const x86_64Asset = release.assets.find((a: any) => 
          a.name.includes("x86_64") || a.name.includes("x64")
        );

        setDownloadInfo({
          version,
          aarch64Url: aarch64Asset?.browser_download_url || `${LATEST_RELEASE_URL}/download/Kai-aarch64.dmg`,
          x86_64Url: x86_64Asset?.browser_download_url || `${LATEST_RELEASE_URL}/download/Kai-x86_64.dmg`,
          loading: false,
          error: null,
        });
      } catch (err) {
        // Fallback to expected URLs
        setDownloadInfo({
          version: "v1.0.0",
          aarch64Url: `${LATEST_RELEASE_URL}/download/Kai-aarch64.dmg`,
          x86_64Url: `${LATEST_RELEASE_URL}/download/Kai-x86_64.dmg`,
          loading: false,
          error: null,
        });
      }
    };

    fetchRelease();
  }, []);

  const getDownloadUrl = () => {
    // Detect architecture
    const isArm = /arm|aarch64/i.test(navigator.userAgent);
    return isArm ? downloadInfo.aarch64Url : downloadInfo.x86_64Url;
  };

  const handleDownload = () => {
    // Link to GitHub releases for all platforms
    window.open(`https://github.com/${GITHUB_REPO}/releases/latest`, '_blank');
  };

  const features = [
    {
      icon: MemoryStick,
      title: "Persistent Memory",
      description: "Three layers of memory: Soul (your identity), Archival (long-term knowledge), and Recall (conversation history). Kai never forgets.",
      color: "from-teal-500 to-teal-600"
    },
    {
      icon: Bot,
      title: "Background Agents",
      description: "Schedule autonomous workflows that run on cron. Research, code reviews, content creation — all running automatically.",
      color: "from-violet-500 to-violet-600"
    },
    {
      icon: Terminal,
      title: "20+ Tools",
      description: "Bash commands, file operations, web search & browsing, image generation, Git operations, MCP servers, and more.",
      color: "from-blue-500 to-blue-600"
    },
    {
      icon: Brain,
      title: "Multi-Model Power",
      description: "Powered by OpenRouter. Kimi K2.5 for reasoning, Qwen3 for complex tasks, Gemini Flash for image generation.",
      color: "from-amber-500 to-amber-600"
    },
    {
      icon: Workflow,
      title: "Sub-Agents",
      description: "Spawn explorer, planner, and worker agents in parallel. Complex tasks get done faster with intelligent coordination.",
      color: "from-rose-500 to-rose-600"
    },
    {
      icon: Zap,
      title: "Project-Aware",
      description: "Auto-detects project root and scopes memory per-project. Every conversation has the right context automatically.",
      color: "from-green-500 to-green-600"
    }
  ];

  const tools = [
    { icon: Terminal, name: "Bash" },
    { icon: Globe, name: "Web Search" },
    { icon: Image, name: "Image Gen" },
    { icon: GitBranch, name: "Git" },
    { icon: Cpu, name: "MCP" },
    { icon: Command, name: "20+ more" },
  ];

  const testimonials = [
    {
      quote: "The background agents changed how I work. I have agents monitoring my repos, summarizing research papers, and drafting content — all automatically.",
      author: "Indie Developer",
      role: "Building in public"
    },
    {
      quote: "Finally an AI that remembers my project structure. I don't have to re-explain my codebase every session.",
      author: "Fullstack Engineer",
      role: "Startup founder"
    },
    {
      quote: "Built my entire SaaS MVP with Kai. The sub-agents handled the research, code structure, and documentation in parallel.",
      author: "Solo Founder",
      role: "$10K MRR"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white overflow-x-hidden">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                Kai
              </span>
            </div>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm text-slate-400 hover:text-white transition-colors">Features</a>
              <a href="#download" className="text-sm text-slate-400 hover:text-white transition-colors">Download</a>
              <a 
                href={`https://github.com/${GITHUB_REPO}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                <GithubIcon className="w-4 h-4" />
                GitHub
              </a>
            </div>

            {/* Mobile menu button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-slate-400 hover:text-white"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isMobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-slate-900 border-b border-slate-800">
            <div className="px-4 py-3 space-y-2">
              <a href="#features" className="block py-2 text-slate-400 hover:text-white">Features</a>
              <a href="#download" className="block py-2 text-slate-400 hover:text-white">Download</a>
              <a href={`https://github.com/${GITHUB_REPO}`} className="block py-2 text-slate-400 hover:text-white">GitHub</a>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 mb-8">
            <Sparkles className="w-4 h-4 text-teal-400" />
            <span className="text-sm font-medium text-teal-400">Now Available — macOS, Windows & Linux</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
            <span className="bg-gradient-to-r from-teal-400 via-teal-500 to-teal-600 bg-clip-text text-transparent">
              AI that remembers,
            </span>
            <br />
            <span className="text-white">
              builds in the background
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg sm:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Kai is an AI coding assistant with persistent memory, autonomous background agents, and 20+ tools. 
            Never explain your codebase twice.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <button
              onClick={handleDownload}
              className="group flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 rounded-xl font-semibold text-white shadow-lg shadow-teal-500/25 transition-all hover:scale-105"
            >
              <Download className="w-5 h-5 group-hover:animate-bounce" />
              Download Desktop App
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <a
              href={`https://github.com/${GITHUB_REPO}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-4 bg-slate-800 hover:bg-slate-700 rounded-xl font-medium text-white transition-all border border-slate-700 hover:border-slate-600"
            >
              <GithubIcon className="w-5 h-5" />
              View on GitHub
            </a>
          </div>

          {/* Platform icons */}
          <div className="flex items-center justify-center gap-6 mb-4">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              macOS
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
              </svg>
              Windows
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489.117.779.444 1.485.877 2.059.784 1.038 1.93 1.78 3.204 2.145 1.353.388 2.853.136 4.258-.346 1.031-.363 2.048-.921 3.005-1.596 1.412-.993 2.491-2.288 3.233-3.752.7-1.381 1.055-2.874 1.055-4.407 0-1.809-.482-3.553-1.353-5.107-.726-1.302-1.782-2.426-3.053-3.251C15.495.857 14.063.265 12.504 0z"/>
              </svg>
              Linux
            </div>
          </div>

          {/* Version info */}
          {!downloadInfo.loading && downloadInfo.version && (
            <p className="text-sm text-slate-500">
              Latest release: {downloadInfo.version}
            </p>
          )}

          {/* Trust badges */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4" />
              <span>Local-first</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-teal-400" />
              <span>Open Source</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>Free forever</span>
            </div>
          </div>
        </div>

        {/* Hero Image / Terminal Preview */}
        <div className="max-w-4xl mx-auto mt-16 px-4">
          <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-2xl shadow-teal-500/10">
            {/* Terminal Header */}
            <div className="flex items-center gap-2 px-4 py-3 bg-slate-900 border-b border-slate-800">
              <div className="w-3 h-3 rounded-full bg-rose-500" />
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="ml-4 text-xs text-slate-500 font-mono">kai terminal</span>
            </div>
            {/* Terminal Content */}
            <div className="p-6 font-mono text-sm">
              <div className="text-slate-400 mb-2">$ kai agent create daily-research</div>
              <div className="text-teal-400 mb-2">✓ Created background agent</div>
              <div className="text-slate-400 mb-2">$ kai agent run daily-research --schedule="0 9 * * *"</div>
              <div className="text-teal-400 mb-4">✓ Agent scheduled. Will run daily at 9:00 AM.</div>
              <div className="text-slate-500 mb-2">--- Next day ---</div>
              <div className="text-slate-400 mb-2">$ kai notifications</div>
              <div className="text-teal-400">🔔 Research complete: 3 new articles summarized. View results?</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 px-4 sm:px-6 lg:px-8 bg-slate-900/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Everything you need to{" "}
              <span className="text-teal-400">ship faster</span>
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Built for developers who want AI that actually understands their projects and works while they sleep.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <div
                key={i}
                className="group p-6 rounded-2xl bg-slate-800/50 border border-slate-700 hover:border-teal-500/50 transition-all hover:bg-slate-800 hover:-translate-y-1"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4 shadow-lg`}>
                  <feature.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-white">{feature.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tools Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">
            Powered by <span className="text-teal-400">20+ tools</span>
          </h2>
          <p className="text-lg text-slate-400 mb-12">
            Kai can browse the web, generate images, run commands, and integrate with any MCP server.
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            {tools.map((tool, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-5 py-3 rounded-xl bg-slate-800/50 border border-slate-700"
              >
                <tool.icon className="w-5 h-5 text-teal-400" />
                <span className="font-medium">{tool.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-slate-900/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16">
            Loved by <span className="text-teal-400">indie hackers</span>
          </h2>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <div
                key={i}
                className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700"
              >
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Sparkles key={i} className="w-4 h-4 text-teal-400" />
                  ))}
                </div>
                <p className="text-slate-300 mb-6 leading-relaxed">"{t.quote}"</p>
                <div>
                  <div className="font-medium text-white">{t.author}</div>
                  <div className="text-sm text-slate-500">{t.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Download Section */}
      <section id="download" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-teal-600 to-teal-800 p-8 sm:p-12 text-center">
            {/* Background pattern */}
            <div className="absolute inset-0 opacity-10">
              <div className="absolute inset-0" style={{
                backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
                backgroundSize: '24px 24px'
              }} />
            </div>

            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                Ready to supercharge your workflow?
              </h2>
              <p className="text-lg text-teal-100 mb-8 max-w-xl mx-auto">
                Join thousands of developers shipping faster with Kai. 
                Free, open source, and runs locally on your machine.
              </p>

              <button
                onClick={handleDownload}
                disabled={downloadInfo.loading}
                className="inline-flex items-center gap-3 px-8 py-4 bg-white text-teal-700 rounded-xl font-bold shadow-xl hover:bg-teal-50 transition-all hover:scale-105 disabled:opacity-50"
              >
                <Download className="w-5 h-5" />
                {downloadInfo.loading ? "Loading..." : "Download for macOS"}
              </button>

              <div className="mt-6 flex items-center justify-center gap-6 text-sm text-teal-100">
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  Free forever
                </span>
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  Open source
                </span>
                <span className="flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  Local-first
                </span>
              </div>

              {/* Architecture links */}
              <div className="mt-8 pt-8 border-t border-teal-500/30">
                <p className="text-sm text-teal-200 mb-4">Need a specific architecture?</p>
                <div className="flex flex-wrap justify-center gap-3">
                  {downloadInfo.aarch64Url && (
                    <a
                      href={downloadInfo.aarch64Url}
                      className="px-4 py-2 rounded-lg bg-teal-700/50 hover:bg-teal-700 text-sm text-white transition-colors"
                    >
                      Apple Silicon (M1/M2/M3)
                    </a>
                  )}
                  {downloadInfo.x86_64Url && (
                    <a
                      href={downloadInfo.x86_64Url}
                      className="px-4 py-2 rounded-lg bg-teal-700/50 hover:bg-teal-700 text-sm text-white transition-colors"
                    >
                      Intel Mac
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-slate-800">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold">Kai</span>
            </div>

            <div className="flex items-center gap-6">
              <a
                href={`https://github.com/${GITHUB_REPO}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-white transition-colors"
              >
                <GithubIcon className="w-5 h-5" />
              </a>
              <a
                href="https://twitter.com/tim_moreton"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-white transition-colors"
              >
                <TwitterIcon className="w-5 h-5" />
              </a>
              <a
                href="https://youtube.com/@TheTravellingDeveloper"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-white transition-colors"
              >
                <YoutubeIcon className="w-5 h-5" />
              </a>
            </div>

            <p className="text-sm text-slate-500">
              Built by{" "}
              <a 
                href="https://twitter.com/tim_moreton"
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-400 hover:text-teal-300"
              >
                @tim_moreton
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
