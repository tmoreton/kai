import { useAppStore } from "../stores/appStore";
import { X, Wrench, Copy, AlertTriangle } from "lucide-react";

export function ErrorDialog() {
  const { currentError, clearError } = useAppStore();

  if (!currentError) return null;

  const handleCopy = () => {
    const text = currentError.details
      ? `${currentError.message}\n\n${currentError.details}`
      : currentError.message;
    navigator.clipboard.writeText(text);
  };

  const handleFix = () => {
    // Would trigger AI fix - placeholder for now
    console.log("Fix error:", currentError);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) clearError();
      }}
    >
      <div className="bg-card border border-destructive rounded-2xl max-w-lg w-[90%] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border-b border-destructive/20">
          <AlertTriangle className="w-6 h-6 text-destructive" />
          <h3 className="font-semibold text-destructive flex-1">Something went wrong</h3>
          <button
            onClick={clearError}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-foreground">{currentError.message}</p>

          {currentError.details && (
            <div className="bg-gray-900 rounded-lg p-3 overflow-auto max-h-48">
              <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">
                {currentError.details}
              </pre>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {currentError.fixable && (
              <button
                onClick={handleFix}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
              >
                <Wrench className="w-4 h-4" />
                Fix This
              </button>
            )}
            <button
              onClick={handleCopy}
              className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent/50"
            >
              <Copy className="w-4 h-4 inline mr-1" />
              Copy
            </button>
            <button
              onClick={clearError}
              className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent/50"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
