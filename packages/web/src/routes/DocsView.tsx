import { useEffect } from "react";
import { ExternalLink } from "lucide-react";

export function DocsView() {
  useEffect(() => {
    // Redirect to external docs site
    window.location.href = "https://kai-docs-three.vercel.app/";
  }, []);

  return (
    <div className="h-full flex flex-col items-center justify-center p-4">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-kai-teal/10 flex items-center justify-center mx-auto">
          <ExternalLink className="w-6 h-6 text-kai-teal" />
        </div>
        <h2 className="text-xl font-semibold text-kai-text">Redirecting to Documentation</h2>
        <p className="text-muted-foreground">
          Taking you to{" "}
          <a
            href="https://kai-docs-three.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-kai-teal hover:underline"
          >
            kai-docs-three.vercel.app
          </a>
        </p>
        <p className="text-xs text-muted-foreground">
          Not redirected?{" "}
          <a
            href="https://kai-docs-three.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-kai-teal hover:underline"
          >
            Click here
          </a>
        </p>
      </div>
    </div>
  );
}
