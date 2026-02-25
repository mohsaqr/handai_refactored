"use client"

import * as React from "react"
import {
    BookOpen,
    Bot,
    Columns,
    Database,
    Edit3,
    FlaskConical,
    History,
    LayoutDashboard,
    Settings,
    Users,
    Wand2,
    Sparkles,
    FileArchive,
    MousePointer2,
    AlertCircle,
    Cpu,
} from "lucide-react"

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@/components/ui/sidebar"
import { useActiveModel } from "@/lib/hooks"
import { useAppStore } from "@/lib/store"
import { toast } from "sonner"

const data = {
    navMain: [
        {
            title: "Data Processing",
            items: [
                {
                    title: "Transform Data",
                    url: "/transform",
                    icon: Wand2,
                },
                {
                    title: "General Automator",
                    url: "/automator",
                    icon: Database,
                },
                {
                    title: "Generate Data",
                    url: "/generate",
                    icon: Sparkles,
                },
                {
                    title: "Process Documents",
                    url: "/process-documents",
                    icon: FileArchive,
                },
            ],
        },
        {
            title: "Qualitative Analysis",
            items: [
                {
                    title: "Qualitative Coder",
                    url: "/qualitative-coder",
                    icon: Edit3,
                },
                {
                    title: "Consensus Coder",
                    url: "/consensus-coder",
                    icon: Users,
                },
                {
                    title: "AI Coder",
                    url: "/ai-coder",
                    icon: Bot,
                },
                {
                    title: "Manual Coder",
                    url: "/manual-coder",
                    icon: MousePointer2,
                },
                {
                    title: "Model Comparison",
                    url: "/model-comparison",
                    icon: Columns,
                },
                {
                    title: "Codebook Generator",
                    url: "/codebook-generator",
                    icon: BookOpen,
                },
                {
                    title: "Abstract Screener",
                    url: "/abstract-screener",
                    icon: FlaskConical,
                },
            ],
        },
        {
            title: "System",
            items: [
                {
                    title: "Historical Runs",
                    url: "/history",
                    icon: History,
                },
                {
                    title: "Settings",
                    url: "/settings",
                    icon: Settings,
                },
            ],
        },
    ],
}

function ModelIndicator() {
    const model = useActiveModel()

    if (!model) {
        return (
            <a
                href="/settings"
                className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 hover:opacity-80 transition-opacity border border-amber-200 dark:border-amber-800"
            >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">No model configured</span>
            </a>
        )
    }

    return (
        <a
            href="/settings"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-xs hover:bg-muted/50 transition-colors border border-border"
        >
            <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none mb-0.5">
                    {model.providerId}
                </div>
                <div className="font-medium truncate leading-none">{model.defaultModel}</div>
            </div>
        </a>
    )
}

// Placeholder model names used in the store defaults — safe to overwrite
const LOCAL_PLACEHOLDERS: Record<string, string[]> = {
    ollama: ["gpt-oss:latest", ""],
    lmstudio: ["local-model", ""],
};

function useLocalProviderDetection() {
    const { providers, setProviderConfig } = useAppStore();

    React.useEffect(() => {
        const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

        const fetchDetected = isTauri
            ? // In Tauri (no API routes): probe Ollama and LM Studio directly from the browser.
              // The desktop WebView has no CORS restrictions for localhost requests.
              Promise.all([
                  fetch("http://localhost:11434/api/tags").then((r) => r.json()).catch(() => null),
                  fetch("http://localhost:1234/v1/models").then((r) => r.json()).catch(() => null),
              ]).then(([ollama, lm]) => {
                  const result: Record<string, string[]> = {};
                  if (ollama?.models) {
                      result.ollama = (ollama.models as { name: string }[]).map((m) => m.name);
                  }
                  if (lm?.data) {
                      result.lmstudio = (lm.data as { id: string }[]).map((m) => m.id);
                  }
                  return result;
              })
            : fetch("/api/local-models").then((r) => r.json());

        fetchDetected
            .then((detected: Record<string, string[]>) => {
                for (const [provider, models] of Object.entries(detected)) {
                    if (!models.length) continue;
                    const current = providers[provider];
                    if (!current) continue;

                    const isPlaceholder = LOCAL_PLACEHOLDERS[provider]?.includes(current.defaultModel);
                    const modelMissing = !models.includes(current.defaultModel);

                    const updates: Record<string, unknown> = { isEnabled: true };
                    if (isPlaceholder || modelMissing) updates.defaultModel = models[0];

                    const wasDisabled = !current.isEnabled;
                    const modelChanged = updates.defaultModel !== undefined;

                    setProviderConfig(provider, updates as Parameters<typeof setProviderConfig>[1]);

                    if (wasDisabled || modelChanged) {
                        const label = provider === "ollama" ? "Ollama" : "LM Studio";
                        toast.success(`${label} detected`, {
                            description: `${models.length} model${models.length !== 1 ? "s" : ""} available · using ${updates.defaultModel ?? current.defaultModel}`,
                            duration: 4000,
                        });
                    }
                }
            })
            .catch(() => {}); // silent if not running
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // run once on mount — isTauri is stable
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    useLocalProviderDetection();
    return (
        <Sidebar collapsible="icon" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <a href="/">
                                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                                    <LayoutDashboard className="size-4" />
                                </div>
                                <div className="flex flex-col gap-0.5 leading-none">
                                    <span className="font-semibold">Handai</span>
                                    <span className="">AI Data Suite</span>
                                </div>
                            </a>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                {data.navMain.map((group) => (
                    <SidebarGroup key={group.title}>
                        <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {group.items.map((item) => (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton asChild tooltip={item.title}>
                                            <a href={item.url}>
                                                <item.icon />
                                                <span>{item.title}</span>
                                            </a>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                ))}
            </SidebarContent>
            <SidebarFooter className="p-2">
                <ModelIndicator />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    )
}
