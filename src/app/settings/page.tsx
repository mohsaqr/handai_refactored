"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAppStore } from "@/lib/store";
import { PROMPTS, getPrompt, setPromptOverride, clearPromptOverride } from "@/lib/prompts";
import { toast } from "sonner";
import { Key, ShieldCheck, Loader2, Wifi, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google (Gemini)",
  groq: "Groq",
  together: "Together AI",
  azure: "Azure OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama (Local)",
  lmstudio: "LM Studio (Local)",
  custom: "Custom OpenAI-Compatible",
};

const PROMPT_CATEGORIES = ["transform", "qualitative", "consensus", "codebook", "generate", "automator", "ai_coder"];

export default function SettingsPage() {
  const { providers, setProviderConfig } = useAppStore();
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [promptValues, setPromptValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setPromptValues(Object.fromEntries(Object.keys(PROMPTS).map((id) => [id, getPrompt(id)])));
  }, []);

  const savePrompt = (id: string) => {
    setPromptOverride(id, promptValues[id]);
    toast.success("Prompt saved");
  };

  const resetPrompt = (id: string) => {
    clearPromptOverride(id);
    setPromptValues((prev) => ({ ...prev, [id]: PROMPTS[id].defaultValue }));
    toast.success("Prompt reset to default");
  };

  const testConnection = async (id: string) => {
    const config = providers[id];
    if (!config.isLocal && !config.apiKey) {
      return toast.error("Enter an API key first");
    }

    setIsTesting(id);
    try {
      const res = await fetch("/api/process-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: id,
          model: config.defaultModel,
          apiKey: config.apiKey || "local",
          baseUrl: config.baseUrl,
          systemPrompt: "You are a helpful assistant.",
          userContent: "Reply with the single word: OK",
          temperature: 0,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(`${PROVIDER_LABELS[id] ?? id} connection successful!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${PROVIDER_LABELS[id] ?? id} connection failed`, { description: msg });
    } finally {
      setIsTesting(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1">
        <h1 className="text-4xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm">Configure AI providers and application preferences</p>
      </div>

      {/* Providers */}
      <div className="space-y-3 pb-8">
        {Object.entries(providers).map(([id, config]) => (
          <div
            key={id}
            className={`border rounded-xl transition-opacity ${config.isEnabled ? "" : "opacity-50"}`}
          >
            {/* Provider header */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="flex items-center gap-2">
                {config.isLocal ? (
                  <Wifi className="h-4 w-4 text-green-500" />
                ) : (
                  <Key className="h-4 w-4 text-primary" />
                )}
                <span className="font-semibold text-sm">{PROVIDER_LABELS[id] ?? id}</span>
                {config.isLocal && (
                  <Badge variant="outline" className="text-[10px] text-green-600 border-green-500/30">
                    Local
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Enabled</Label>
                  <Switch
                    checked={config.isEnabled}
                    onCheckedChange={(v) => setProviderConfig(id, { isEnabled: v })}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testConnection(id)}
                  disabled={isTesting !== null || !config.isEnabled}
                >
                  {isTesting === id ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 mr-2" />
                  )}
                  Test
                </Button>
              </div>
            </div>

            {/* Provider fields */}
            <div className="px-5 py-4 space-y-3">
              <div className="grid sm:grid-cols-2 gap-4">
                {!config.isLocal && (
                  <div className="space-y-1">
                    <Label className="text-xs">API Key</Label>
                    <Input
                      type="password"
                      placeholder={id === "azure" ? "Azure API Key" : "sk-..."}
                      value={config.apiKey}
                      onChange={(e) => setProviderConfig(id, { apiKey: e.target.value })}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Default Model</Label>
                  <Input
                    placeholder="e.g. gpt-4o"
                    value={config.defaultModel}
                    onChange={(e) => setProviderConfig(id, { defaultModel: e.target.value })}
                  />
                </div>
              </div>
              {(id === "openai" || id === "together" || id === "openrouter" || id === "ollama" || id === "lmstudio" || id === "custom" || id === "azure") && (
                <div className="space-y-1">
                  <Label className="text-xs">
                    {id === "azure" ? "Azure Resource Name" : "Base URL (optional)"}
                  </Label>
                  <Input
                    placeholder={
                      id === "azure"
                        ? "my-resource-name"
                        : id === "ollama"
                        ? "http://localhost:11434/v1"
                        : id === "lmstudio"
                        ? "http://localhost:1234/v1"
                        : "https://api.example.com/v1"
                    }
                    value={config.baseUrl ?? ""}
                    onChange={(e) => setProviderConfig(id, { baseUrl: e.target.value })}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t pt-8">
        <Collapsible open={promptsOpen} onOpenChange={setPromptsOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full px-4 py-3 border rounded-xl hover:bg-muted/20 transition-colors">
            {promptsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="font-semibold text-sm">Prompt Templates ({Object.keys(PROMPTS).length})</span>
            <span className="text-xs text-muted-foreground ml-1">— customize system prompts used by each tool</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 space-y-6">
              {PROMPT_CATEGORIES.map((category) => {
                const categoryPrompts = Object.values(PROMPTS).filter((p) => p.category === category);
                if (categoryPrompts.length === 0) return null;
                return (
                  <div key={category} className="space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1">
                      {category.replace("_", " ")}
                    </div>
                    {categoryPrompts.map((prompt) => {
                      const current = promptValues[prompt.id] ?? prompt.defaultValue;
                      const isModified = current !== prompt.defaultValue;
                      return (
                        <div key={prompt.id} className="space-y-2 border rounded-lg p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Label className="text-sm font-medium">{prompt.name}</Label>
                              {isModified && (
                                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">Modified</Badge>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground"
                                disabled={!isModified}
                                onClick={() => resetPrompt(prompt.id)}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" /> Reset
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => savePrompt(prompt.id)}
                              >
                                Save
                              </Button>
                            </div>
                          </div>
                          <Textarea
                            className="font-mono text-xs min-h-[100px] resize-y"
                            value={current}
                            onChange={(e) =>
                              setPromptValues((prev) => ({ ...prev, [prompt.id]: e.target.value }))
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
