"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";
import { Key, ShieldCheck, Loader2, Wifi } from "lucide-react";

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

export default function SettingsPage() {
  const { providers, setProviderConfig } = useAppStore();
  const [isTesting, setIsTesting] = useState<string | null>(null);

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
      <div className="space-y-3">
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
    </div>
  );
}
