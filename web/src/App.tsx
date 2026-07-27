import { useState, useEffect, useCallback, useMemo, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Server,
  Database,
  Settings as SettingsIcon,
  Puzzle,
  Terminal,
  Route,
  MessageSquare,
  ChevronDown,
} from "lucide-react";
import { api } from "./api/client";
import { applyAppLocale, parseAppLocale } from "./i18n";
import Chat from "./features/chat/Chat";
import ClientConfig from "./features/client-config/ClientConfig";
import Dashboard from "./features/dashboard/Dashboard";
import Providers from "./features/providers/Providers";
import SmartRouting from "./features/smart-routing/SmartRouting";
import Logs from "./features/logs/Logs";
import Settings from "./features/settings/Settings";
import Capabilities from "./features/capabilities/Capabilities";
import { LanguageModal } from "./components/LanguageModal";
import { VersionFooter } from "./components/VersionFooter";
import { WindowCaptionButtons } from "./components/WindowCaptionButtons";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { isDarwinDesktop, isElectronDesktop, needsWindowCaptionButtons } from "./lib/desktopShell";
import { cn } from "./lib/utils";

// CCRelay icon as data URI (works in VSCode webview)
const iconSvg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'%3E%3Cdefs%3E%3ClinearGradient id='purpleGradient' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%239B59B6;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%238E44AD;stop-opacity:1' /%3E%3C/linearGradient%3E%3ClinearGradient id='grayGradient' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%2395A5A6;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%237F8C8D;stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='64' cy='64' r='56' fill='%232C3E50' opacity='0.1'/%3E%3Cpath d='M 32 75 Q 32 45 50 45 L 64 45' stroke='url(%23purpleGradient)' stroke-width='10' stroke-linecap='round' fill='none'/%3E%3Cpath d='M 52 35 L 66 45 L 52 55' fill='url(%23purpleGradient)' stroke='url(%23purpleGradient)' stroke-width='3' stroke-linejoin='round'/%3E%3Cpath d='M 96 53 Q 96 83 78 83 L 64 83' stroke='url(%23grayGradient)' stroke-width='10' stroke-linecap='round' fill='none'/%3E%3Cpath d='M 76 93 L 62 83 L 76 73' fill='url(%23grayGradient)' stroke='url(%23grayGradient)' stroke-width='3' stroke-linejoin='round'/%3E%3Ccircle cx='64' cy='64' r='8' fill='url(%23purpleGradient)'/%3E%3Ccircle cx='64' cy='64' r='4' fill='%23FFFFFF'/%3E%3Cline x1='22' y1='64' x2='32' y2='64' stroke='%237F8C8D' stroke-width='4' stroke-linecap='round'/%3E%3Cline x1='96' y1='64' x2='106' y2='64' stroke='%237F8C8D' stroke-width='4' stroke-linecap='round'/%3E%3Ccircle cx='18' cy='64' r='4' fill='%2395A5A6'/%3E%3Ccircle cx='110' cy='64' r='4' fill='%2395A5A6'/%3E%3C/svg%3E`;

type Tab =
  | "chat"
  | "clientConfig"
  | "dashboard"
  | "smartRouting"
  | "providers"
  | "capabilities"
  | "logs"
  | "settings";

const VALID_TABS: Tab[] = [
  "chat",
  "clientConfig",
  "dashboard",
  "smartRouting",
  "providers",
  "capabilities",
  "logs",
  "settings",
];

type NavItem = {
  id: Tab;
  labelKey: `nav.${Tab}`;
  icon: ComponentType<{ className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { id: "chat", labelKey: "nav.chat", icon: MessageSquare },
  { id: "clientConfig", labelKey: "nav.clientConfig", icon: Terminal },
  { id: "dashboard", labelKey: "nav.dashboard", icon: Server },
  { id: "smartRouting", labelKey: "nav.smartRouting", icon: Route },
  { id: "providers", labelKey: "nav.providers", icon: Activity },
  { id: "capabilities", labelKey: "nav.capabilities", icon: Puzzle },
  { id: "logs", labelKey: "nav.logs", icon: Database },
  { id: "settings", labelKey: "nav.settings", icon: SettingsIcon },
];

function useHashTab(defaultTab: Tab): [Tab, (tab: Tab) => void] {
  const getHashTab = useCallback((): Tab => {
    const hash = window.location.hash.replace("#", "") as Tab;
    return VALID_TABS.includes(hash) ? hash : defaultTab;
  }, [defaultTab]);

  const [activeTab, setActiveTabState] = useState<Tab>(getHashTab());

  useEffect(() => {
    const handleHashChange = () => {
      setActiveTabState(getHashTab());
    };

    window.addEventListener("hashchange", handleHashChange);
    if (!window.location.hash) {
      window.history.replaceState(null, "", `#${defaultTab}`);
    }

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [defaultTab, getHashTab]);

  const setActiveTab = (tab: Tab) => {
    window.location.hash = tab;
  };

  return [activeTab, setActiveTab];
}

function App() {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useHashTab("clientConfig");
  const [languagePromptDismissed, setLanguagePromptDismissed] = useState(false);

  const { data: config } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const loggingEnabled = config?.logging?.enabled ?? true;

  const showLanguagePrompt =
    config !== undefined &&
    !languagePromptDismissed &&
    !parseAppLocale(config.server?.locale) &&
    !parseAppLocale(window.CCRELAY_LOCALE);

  // Sync language when config changes (e.g. Settings save in Electron).
  useEffect(() => {
    const locale = parseAppLocale(config?.server?.locale) ?? parseAppLocale(window.CCRELAY_LOCALE);
    if (locale) {
      void applyAppLocale(locale);
    }
  }, [config?.server?.locale]);

  // Redirect away from logs tab if logging is disabled
  useEffect(() => {
    if (!loggingEnabled && activeTab === "logs") {
      setActiveTab("clientConfig");
    }
  }, [loggingEnabled, activeTab, setActiveTab]);

  const navItems = useMemo(
    () => NAV_ITEMS.filter(item => item.id !== "logs" || loggingEnabled),
    [loggingEnabled]
  );

  const activeNav = navItems.find(item => item.id === activeTab) ?? navItems[0];
  const ActiveIcon = activeNav.icon;

  const uiLanguageKey = i18n.resolvedLanguage ?? i18n.language;
  const electronDesktop = isElectronDesktop();
  const darwinDesktop = isDarwinDesktop();
  const showCaptionButtons = needsWindowCaptionButtons();

  return (
    <div key={uiLanguageKey} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Header - Tab Style (Electron: frameless drag region + OS chrome) */}
      <header
        className={cn(
          "bg-card relative flex-shrink-0 border-b border-border",
          electronDesktop && "electron-drag select-none"
        )}
      >
        <div className={cn("max-w-full pl-2 sm:pl-4", darwinDesktop && "pl-[78px] sm:pl-[78px]")}>
          <div className="flex h-10 items-center gap-2">
            <div className="flex min-w-0 shrink-0 items-center gap-1.5">
              <img src={iconSvg} alt="CCRelay" className="h-6 w-6 sm:h-8 sm:w-8" />
              <h1 className="text-[13px] sm:text-sm font-semibold">CCRelay</h1>
            </div>

            {/* Wide: horizontal tabs */}
            <nav
              className={cn(
                "ml-auto hidden min-w-0 items-center overflow-hidden lg:flex",
                electronDesktop && "electron-no-drag"
              )}
            >
              <div className="flex max-w-full items-center">
                {navItems.map(item => {
                  const Icon = item.icon;
                  const selected = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        "flex h-10 min-w-0 shrink items-center justify-center gap-1.5 px-3 text-xs transition-all duration-200 xl:min-w-[80px] xl:px-4",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground hover:bg-primary/15"
                      )}
                      onClick={() => setActiveTab(item.id)}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </nav>

            {/* Narrow: collapsed current-tab menu */}
            <div
              className={cn(
                "ml-auto flex min-w-0 items-center lg:hidden",
                electronDesktop && "electron-no-drag"
              )}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 max-w-[min(100%,16rem)] gap-1.5 border-border bg-muted/40 px-2.5 text-xs"
                    aria-label={t("nav.menu")}
                  >
                    <ActiveIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t(activeNav.labelKey)}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={6}
                  className="w-56 min-w-[12rem] border border-border bg-card p-1 text-card-foreground shadow-md"
                >
                  <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("nav.menu")}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={activeTab}
                    onValueChange={value => setActiveTab(value as Tab)}
                  >
                    {navItems.map(item => {
                      const Icon = item.icon;
                      return (
                        <DropdownMenuRadioItem
                          key={item.id}
                          value={item.id}
                          className="gap-2 rounded-md px-2 py-1.5 text-xs data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span className="truncate">{t(item.labelKey)}</span>
                        </DropdownMenuRadioItem>
                      );
                    })}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {showCaptionButtons && <WindowCaptionButtons className="shrink-0" />}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main
        className={cn(
          "flex-1 min-h-0 overscroll-y-contain px-2 sm:px-4 py-3 text-xs",
          activeTab === "chat"
            ? "overflow-hidden flex flex-col"
            : "overflow-y-auto overflow-x-hidden"
        )}
      >
        {activeTab === "chat" && <Chat />}
        {activeTab === "clientConfig" && <ClientConfig />}
        {activeTab === "dashboard" && <Dashboard />}
        {activeTab === "smartRouting" && <SmartRouting />}
        {activeTab === "providers" && <Providers />}
        {activeTab === "capabilities" && <Capabilities />}
        {activeTab === "logs" && <Logs />}
        {activeTab === "settings" && <Settings />}
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 border-t bg-card px-2 sm:px-4 py-2">
        <div className="max-w-full flex justify-between items-center">
          <p className="text-[11px] text-muted-foreground">
            &copy; 2026{" "}
            <a
              href="https://inflab.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              inflab.org
            </a>{" "}
            {t("app.footer.project")}
          </p>
          <VersionFooter />
        </div>
      </footer>

      <LanguageModal
        open={showLanguagePrompt}
        onOpenChange={open => {
          if (!open) {
            setLanguagePromptDismissed(true);
          }
        }}
      />
    </div>
  );
}

export default App;
