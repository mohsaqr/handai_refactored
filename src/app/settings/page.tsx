"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useAppStore } from "@/lib/store";
import { PROMPTS, getPrompt, setPromptOverride, clearPromptOverride } from "@/lib/prompts";
import { toast } from "sonner";
import { Key, ShieldCheck, Loader2, Wifi, RotateCcw, ChevronDown, Bot, Sliders } from "lucide-react";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  groq: "Groq",
  together: "Together AI",
  azure: "Azure OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  custom: "Custom",
};

const CLOUD_PROVIDERS = ["openai", "anthropic", "google", "groq", "together", "azure", "openrouter"];
const LOCAL_PROVIDERS = ["ollama", "lmstudio", "custom"];

const PROMPT_CATEGORIES = ["transform", "qualitative", "consensus", "codebook", "generate", "automator", "ai_coder"];
const PROMPT_CATEGORY_LABELS: Record<string, string> = {
  transform: "Transform Data",
  qualitative: "Qualitative Coder",
  consensus: "Consensus Coder",
  codebook: "Codebook Generator",
  generate: "Generate Data",
  automator: "Automator",
  ai_coder: "AI Coder",
};

const BASE_URL_PROVIDERS = new Set(["openai", "together", "openrouter", "ollama", "lmstudio", "custom", "azure"]);

export default function SettingsPage() {
  const { providers, setProviderConfig } = useAppStore();
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [promptValues, setPromptValues] = useState<Record<string, string>>({});
  const [activeSection, setActiveSection] = useState("providers");
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());

  const providersRef = useRef<HTMLDivElement>(null);
  const promptsRef = useRef<HTMLDivElement>(null);

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
    toast.success("Reset to default");
  };

  const testConnection = async (id: string) => {
    const config = providers[id];
    if (!config.isLocal && !config.apiKey) return toast.error("Enter an API key first");
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
      toast.success(`${PROVIDER_LABELS[id] ?? id} — connected`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${PROVIDER_LABELS[id] ?? id} failed`, { description: msg });
    } finally {
      setIsTesting(null);
    }
  };

  const scrollTo = (section: string) => {
    setActiveSection(section);
    (section === "providers" ? providersRef : promptsRef).current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const getStatus = (id: string) => {
    const c = providers[id];
    if (!c.isEnabled) return "disabled";
    if (c.isLocal) return "local";
    if (!c.apiKey) return "no-key";
    return "ready";
  };

  const modifiedCount = Object.keys(PROMPTS).filter(
    (id) => (promptValues[id] ?? PROMPTS[id].defaultValue) !== PROMPTS[id].defaultValue
  ).length;

  const renderProvider = (id: string) => {
    const config = providers[id];
    const status = getStatus(id);
    const showBaseUrl = BASE_URL_PROVIDERS.has(id);
    const colCount = showBaseUrl ? (config.isLocal ? 2 : 3) : (config.isLocal ? 1 : 2);

    const dotColor =
      status === "ready" || status === "local"
        ? "bg-green-500"
        : status === "no-key"
        ? "bg-amber-400"
        : "bg-muted-foreground/25";

    return (
      <div
        key={id}
        className={`rounded-xl border transition-all ${
          config.isEnabled ? "border-border bg-card" : "border-border/30 bg-muted/10 opacity-55"
        }`}
      >
        {/* Header row */}
        <div className="flex items-center gap-3 px-4 py-3">
          <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
          {config.isLocal ? (
            <Wifi className="h-3.5 w-3.5 text-green-500 shrink-0" />
          ) : (
            <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="font-semibold text-sm flex-1 truncate">{PROVIDER_LABELS[id] ?? id}</span>
          {config.isLocal && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-green-600 border-green-500/40">
              local
            </Badge>
          )}
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-[11px] text-muted-foreground">Enabled</span>
            <Switch
              checked={config.isEnabled}
              onCheckedChange={(v) => setProviderConfig(id, { isEnabled: v })}
              size="sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2.5 ml-1"
            onClick={() => testConnection(id)}
            disabled={isTesting !== null || !config.isEnabled}
          >
            {isTesting === id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            <span className="ml-1">Test</span>
          </Button>
        </div>

        {/* Fields */}
        <div className={`px-4 pb-3.5 pt-0 grid gap-x-4 gap-y-2.5`}
          style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}
        >
          {!config.isLocal && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {id === "azure" ? "API Key" : "API Key"}
              </Label>
              <Input
                type="password"
                placeholder={id === "azure" ? "Azure API Key" : "sk-..."}
                value={config.apiKey}
                onChange={(e) => setProviderConfig(id, { apiKey: e.target.value })}
                className="h-8 text-xs font-mono"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Default Model</Label>
            <Input
              placeholder="e.g. gpt-4o"
              value={config.defaultModel}
              onChange={(e) => setProviderConfig(id, { defaultModel: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </div>
          {showBaseUrl && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {id === "azure" ? "Resource Name" : "Base URL"}
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
                className="h-8 text-xs font-mono"
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex gap-10 min-h-[calc(100vh-112px)]">

      {/* ── Sticky side nav ─────────────────────────────────── */}
      <nav className="w-40 shrink-0 pt-1">
        <div className="sticky top-6 space-y-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-3 mb-2">
            Settings
          </p>
          {[
            { id: "providers", label: "AI Providers", icon: Bot },
            { id: "prompts", label: "Prompt Templates", icon: Sliders, badge: modifiedCount },
          ].map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                activeSection === id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{label}</span>
              {badge ? (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-amber-600 border-amber-300">
                  {badge}
                </Badge>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Main content ────────────────────────────────────── */}
      <div className="flex-1 min-w-0 max-w-3xl space-y-14 pb-20">

        {/* ── AI Providers ───────────────────────────────────── */}
        <section ref={providersRef}>
          <div className="mb-5 pb-4 border-b">
            <h2 className="text-lg font-bold">AI Providers</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              The first enabled provider with a configured key is used by default across all tools.
            </p>
          </div>

          <div className="space-y-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3 px-0.5">
                Cloud APIs
              </p>
              <div className="space-y-2">
                {CLOUD_PROVIDERS.map(renderProvider)}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3 px-0.5">
                Local / Self-hosted
              </p>
              <div className="space-y-2">
                {LOCAL_PROVIDERS.map(renderProvider)}
              </div>
            </div>
          </div>
        </section>

        {/* ── Prompt Templates ───────────────────────────────── */}
        <section ref={promptsRef}>
          <div className="mb-5 pb-4 border-b">
            <h2 className="text-lg font-bold">Prompt Templates</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Customize the system prompts used by each tool. Changes are saved to your browser and override the defaults.
            </p>
          </div>

          <div className="space-y-2">
            {PROMPT_CATEGORIES.map((category) => {
              const categoryPrompts = Object.values(PROMPTS).filter((p) => p.category === category);
              if (categoryPrompts.length === 0) return null;
              const isOpen = openCategories.has(category);
              const hasModified = categoryPrompts.some(
                (p) => (promptValues[p.id] ?? p.defaultValue) !== p.defaultValue
              );

              return (
                <div key={category} className="border rounded-xl overflow-hidden">
                  <button
                    onClick={() =>
                      setOpenCategories((prev) => {
                        const next = new Set(prev);
                        next.has(category) ? next.delete(category) : next.add(category);
                        return next;
                      })
                    }
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left"
                  >
                    <span className="text-sm font-medium flex-1">
                      {PROMPT_CATEGORY_LABELS[category] ?? category}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {categoryPrompts.length} {categoryPrompts.length === 1 ? "prompt" : "prompts"}
                    </span>
                    {hasModified && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-amber-600 border-amber-300">
                        modified
                      </Badge>
                    )}
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {isOpen && (
                    <div className="border-t divide-y">
                      {categoryPrompts.map((prompt) => {
                        const current = promptValues[prompt.id] ?? prompt.defaultValue;
                        const isModified = current !== prompt.defaultValue;
                        return (
                          <div key={prompt.id} className="px-4 py-4 space-y-2.5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-medium truncate">{prompt.name}</span>
                                {isModified && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1.5 py-0 h-4 text-amber-600 border-amber-300 shrink-0"
                                  >
                                    modified
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-muted-foreground"
                                  disabled={!isModified}
                                  onClick={() => resetPrompt(prompt.id)}
                                >
                                  <RotateCcw className="h-3 w-3 mr-1" />
                                  Reset
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
                              className="font-mono text-xs min-h-[110px] resize-y"
                              value={current}
                              onChange={(e) =>
                                setPromptValues((prev) => ({ ...prev, [prompt.id]: e.target.value }))
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
