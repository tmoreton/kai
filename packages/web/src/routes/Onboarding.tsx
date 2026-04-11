import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Key, 
  Sparkles, 
  ArrowRight, 
  Check, 
  ExternalLink,
  User,
  Briefcase,
  MessageSquare
} from "lucide-react";
import { settingsQueries } from "../api/queries";
import { api } from "../api/client";
import { Button } from "../components/ui/button";
import { toast } from "../components/Toast";

export function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"profile" | "apiKey">("profile");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Profile form
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [context, setContext] = useState("");
  
  // API key form
  const [apiKey, setApiKey] = useState("");

  const { data: envData } = useSuspenseQuery<{ env: Record<string, string> }>({
    queryKey: ['settings', 'env'],
    queryFn: () => api.settings.getEnv(),
    staleTime: 0,
  });

  const saveProfileMutation = useMutation({
    mutationFn: async (profile: { name: string; role: string; context: string }) => {
      // Get current settings
      const settings = await api.settings.get();
      // Update with profile
      await api.settings.update({
        ...settings.config,
        profile
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Failed to save profile";
      toast.error("Error", message);
    },
  });

  // If already has key, redirect to chat
  if (envData.env.OPENROUTER_API_KEY) {
    navigate("/chat");
    return null;
  }

  const handleSaveProfile = async () => {
    if (!name.trim()) {
      toast.error("Name required", "Please tell us your name");
      return;
    }

    setIsSubmitting(true);
    try {
      await saveProfileMutation.mutateAsync({ 
        name: name.trim(),
        role: role.trim() || "Developer",
        context: context.trim() || "Software development"
      });
      toast.success("Profile saved", "Let's set up your API key");
      setStep("apiKey");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim().startsWith("sk-or-")) {
      toast.error("Invalid key", "OpenRouter keys start with 'sk-or-'");
      return;
    }

    setIsSubmitting(true);
    try {
      // Save API key
      await api.settings.setEnv("OPENROUTER_API_KEY", apiKey.trim());
      
      // Reload provider to pick up new API key
      await api.settings.reloadProvider();
      
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success("Success", `Welcome to Kai${name ? ', ' + name : ''}!`);
      // Navigate to chat - provider is now reloaded with new key
      navigate("/chat");
    } catch (err: any) {
      const message = err instanceof Error ? err.message : "Failed to save API key";
      toast.error("Error", message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Profile step
  if (step === "profile") {
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

          <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-teal-600" />
              Tell us about yourself
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Your Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Alex"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  <Briefcase className="w-4 h-4 inline mr-1" />
                  Role / Title
                </label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g., Full-stack Developer"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  <MessageSquare className="w-4 h-4 inline mr-1" />
                  What are you working on?
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="e.g., Building an AI-powered code editor"
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all resize-none"
                />
              </div>
            </div>
          </div>

          <Button 
            onClick={handleSaveProfile}
            disabled={isSubmitting || !name.trim()}
            className="w-full py-6 text-lg font-semibold"
          >
            {isSubmitting ? "Saving..." : "Continue"}
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>

          <p className="text-center text-xs text-slate-400 mt-4">
            This helps Kai personalize your experience
          </p>
        </div>
      </div>
    );
  }

  // API Key step
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
            {name ? (
              <span className="text-2xl font-bold text-white">{name.charAt(0).toUpperCase()}</span>
            ) : (
              <Key className="w-8 h-8 text-white" />
            )}
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            {name ? `Welcome, ${name}` : "Almost there"}
          </h1>
          <p className="text-slate-600">
            Enter your OpenRouter API key to start using Kai
          </p>
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
                Get a free key at openrouter.ai <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            OpenRouter API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-..."
            className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all font-mono text-sm"
          />
          <p className="mt-2 text-xs text-slate-500">
            Your key is stored locally in ~/.kai/.env and never shared.
          </p>
        </div>

        <Button 
          onClick={handleSaveKey}
          disabled={isSubmitting || !apiKey.trim()}
          className="w-full py-6 text-lg font-semibold"
        >
          {isSubmitting ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
              Starting Kai...
            </>
          ) : (
            <>
              Start Using Kai
              <Check className="w-5 h-5 ml-2" />
            </>
          )}
        </Button>

        <button
          onClick={() => setStep("profile")}
          className="w-full mt-3 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          ← Back to profile
        </button>
      </div>
    </div>
  );
}
