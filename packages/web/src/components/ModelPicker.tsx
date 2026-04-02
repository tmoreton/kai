import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "../lib/utils";

interface Model {
  id: string;
  name: string;
  provider: string;
  icon: string;
}

const MODELS: Model[] = [
  { id: "accounts/fireworks/models/deepseek-v3", name: "DeepSeek V3", provider: "fireworks", icon: "🔥" },
  { id: "accounts/fireworks/models/llama-v3p1-405b-instruct", name: "Llama 3.1 405B", provider: "fireworks", icon: "🦙" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: "anthropic", icon: "🌙" },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", icon: "🤖" },
];

interface ModelPickerProps {
  value?: string;
  onChange?: (modelId: string) => void;
}

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState(value || MODELS[0].id);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedModel = MODELS.find(m => m.id === currentModel) || MODELS[0];

  useEffect(() => {
    // Sync with external value prop
    if (value && value !== currentModel) {
      setCurrentModel(value);
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (modelId: string) => {
    setCurrentModel(modelId);
    onChange?.(modelId);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all",
          "bg-card border border-border hover:border-muted-foreground",
          "shadow-sm hover:shadow"
        )}
      >
        <span className="w-5 h-5 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center text-xs">
          {selectedModel.icon}
        </span>
        <span className="text-foreground">{selectedModel.name}</span>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="p-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1.5">
              Select Model
            </div>
            {MODELS.map((model) => (
              <button
                key={model.id}
                onClick={() => handleSelect(model.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors",
                  currentModel === model.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-accent/50 text-foreground"
                )}
              >
                <span className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center text-sm flex-shrink-0">
                  {model.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{model.name}</div>
                  <div className="text-xs text-muted-foreground capitalize">{model.provider}</div>
                </div>
                {currentModel === model.id && (
                  <Check className="w-4 h-4 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
