import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Key, 
  Sparkles, 
  ArrowRight, 
  Check, 
  ExternalLink,
  Bot,
  GitBranch,
  Globe,
  Terminal,
  Brain
} from "lucide-react";
import { settingsQueries } from "../api/queries";
import { api } from "../api/client";
import { Button } from "../components/ui/button";
import { toast } from "../components/Toast";

const FEATURES = [
  { icon: Brain, label: "Kimi K2.5", desc: "Best-in-class reasoning" },
  { icon: Bot, label: "Background Agents", desc: "Autonomous workflows" },
  { icon: Terminal, label: "20+ Tools", desc: "Bash, files, web, git" },
  { icon: GitBranch, label: "Git Integration", desc: "AI commits & PRs" },
  { icon: Globe, label: "Web Search", desc: "Tavily integration" },
  { icon: Sparkles, label: "Sub-Agents", desc: "Parallel swarms" },
];

export function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [step, setStep] = useState<"welcome" | "key">("welcome");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: envData } = useSuspenseQuery<{ env: Record<string, string> }>({
    queryKey: ['settings', 'env'],
    queryFn: () => api.settings.getEnv(),
    staleTime: 0,
  });

  const setEnvMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => 
      api.settings.setEnv(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Failed to save key";
      toast.error("Error", message);
    },
  });

  // If already has key, redirect to chat
  if (envData.env.OPENROUTER_API_KEY) {
    navigate("/chat");
    return null;
  }

  const handleSaveKey = async () => {
    if (!apiKey.trim().startsWith("sk-or-")) {
      toast.error("Invalid key", "OpenRouter keys start with 'sk-or-'");
      return;
    }

    setIsSubmitting(true);
    try {
      await setEnvMutation.mutateAsync({ 
        key: "OPENROUTER_API_KEY", 
        value: apiKey.trim() 
      });
      toast.success("Success", "API key saved");
      navigate("/chat");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === "welcome") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Welcome to Kai</h1>
            <p className="text-slate-600">
              AI coding assistant with persistent memory and autonomous agents
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-8">
            {FEATURES.map((f) => (
              <div 
                key={f.label} 
                className="p-3 bg-white rounded-xl border border-slate-200 text-center hover:border-teal-200 hover:shadow-sm transition-all"
              >
                <f.icon className="w-5 h-5 mx-auto mb-2 text-teal-600" />
                <div className="text-xs font-medium text-slate-700">{f.label}</div>
                <div className="text-[10px] text-slate-500">{f.desc}</div>
              </div>
            ))}
          </div>

          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <Key className="w-5 h-5 text-teal-600 mt-0.5" />
              <div>
                <h3 className="font-semibold text-teal-900 mb-1">OpenRouter API Key Required</h3>
                <p className="text-sm text-teal-700 mb-2">
                  Kai uses OpenRouter to access Kimi K2.5, a state-of-the-art reasoning model.
                </p>
                <a 
                  href="https://openrouter.ai/keys" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-800"
                >
                  Get a key at openrouter.ai <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>

          <Button 
            onClick={() => setStep("key")}
            className="w-full py-6 text-lg font-semibold"
          >
            Get Started
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>

          <p className="text-center text-xs text-slate-400 mt-4">
            Keys are stored locally in ~/.kai/.env
          </p>
        </div>
      </div>
    );
  }

  // Key input step
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
            <Key className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Add Your API Key</h1>
          <p className="text-slate-600">
            Required to use Kai. Your key stays on your device.
          </p>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              OpenRouter API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-..."
              className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              onKeyDown={(e) => {
                if (e.key === "Enter" && apiKey.trim()) {
                  handleSaveKey();
                }
              }}
            />
            <p className="text-xs text-slate-500 mt-2">
              Get your key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:underline">openrouter.ai/keys</a>
            </p>
          </div>
        </div>

        <Button 
          onClick={handleSaveKey}
          disabled={!apiKey.trim().startsWith("sk-or-") || isSubmitting}
          className="w-full py-6 text-lg font-semibold"
        >
          {isSubmitting ? (
            "Saving..."
          ) : (
            <>
              <Check className="w-5 h-5 mr-2" />
              Save & Continue
            </>
          )}
        </Button>

        <button
          onClick={() => setStep("welcome")}
          className="w-full mt-4 text-sm text-slate-500 hover:text-slate-700"
        >
          Go Back
        </button>
      </div>
    </div>
  );
}
