import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Server, Database, Settings as SettingsIcon } from "lucide-react";
import { api } from "./api/client";
import Dashboard from "./features/dashboard/Dashboard";
import Providers from "./features/providers/Providers";
import Logs from "./features/logs/Logs";
import Settings from "./features/settings/Settings";
import { LanguageModal } from "./components/LanguageModal";

// CCRelay icon as data URI (works in VSCode webview)
const iconSvg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'%3E%3Cdefs%3E%3ClinearGradient id='purpleGradient' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%239B59B6;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%238E44AD;stop-opacity:1' /%3E%3C/linearGradient%3E%3ClinearGradient id='grayGradient' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%2395A5A6;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%237F8C8D;stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='64' cy='64' r='56' fill='%232C3E50' opacity='0.1'/%3E%3Cpath d='M 32 75 Q 32 45 50 45 L 64 45' stroke='url(%23purpleGradient)' stroke-width='10' stroke-linecap='round' fill='none'/%3E%3Cpath d='M 52 35 L 66 45 L 52 55' fill='url(%23purpleGradient)' stroke='url(%23purpleGradient)' stroke-width='3' stroke-linejoin='round'/%3E%3Cpath d='M 96 53 Q 96 83 78 83 L 64 83' stroke='url(%23grayGradient)' stroke-width='10' stroke-linecap='round' fill='none'/%3E%3Cpath d='M 76 93 L 62 83 L 76 73' fill='url(%23grayGradient)' stroke='url(%23grayGradient)' stroke-width='3' stroke-linejoin='round'/%3E%3Ccircle cx='64' cy='64' r='8' fill='url(%23purpleGradient)'/%3E%3Ccircle cx='64' cy='64' r='4' fill='%23FFFFFF'/%3E%3Cline x1='22' y1='64' x2='32' y2='64' stroke='%237F8C8D' stroke-width='4' stroke-linecap='round'/%3E%3Cline x1='96' y1='64' x2='106' y2='64' stroke='%237F8C8D' stroke-width='4' stroke-linecap='round'/%3E%3Ccircle cx='18' cy='64' r='4' fill='%2395A5A6'/%3E%3Ccircle cx='110' cy='64' r='4' fill='%2395A5A6'/%3E%3C/svg%3E`;

type Tab = "dashboard" | "providers" | "logs" | "settings";

const VALID_TABS: Tab[] = ["dashboard", "providers", "logs", "settings"];

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
  const [activeTab, setActiveTab] = useHashTab("dashboard");
  const [version, setVersion] = useState<string | null>(null);
  const [showLangModal, setShowLangModal] = useState(false);
  const [loggingEnabled, setLoggingEnabled] = useState(true);

  useEffect(() => {
    api
      .getVersion()
      .then(v => setVersion(v.version))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const vsLocale = window.CCRELAY_LOCALE;
    if (vsLocale) {
      void i18n.changeLanguage(vsLocale);
    }
    api
      .getConfig()
      .then(cfg => {
        if (!vsLocale) {
          const locale = cfg.server?.locale as string | undefined;
          if (locale) {
            void i18n.changeLanguage(locale);
          } else {
            setShowLangModal(true);
          }
        }
        setLoggingEnabled(cfg.logging?.enabled ?? false);
      })
      .catch(() => {
        if (!vsLocale) setShowLangModal(true);
      });
  }, [i18n]);

  // Redirect away from logs tab if logging is disabled
  useEffect(() => {
    if (!loggingEnabled && activeTab === "logs") {
      setActiveTab("dashboard");
    }
  }, [loggingEnabled, activeTab, setActiveTab]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Header - Tab Style */}
      <header className="bg-card flex-shrink-0 border-b border-border">
        <div className="max-w-full px-2 sm:px-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:h-10 justify-between gap-3 sm:gap-0 pt-3 pb-3 sm:py-0">
            <div className="flex items-center gap-1.5 px-1 sm:px-0">
              <img src={iconSvg} alt="CCRelay" className="h-6 w-6 sm:h-8 sm:w-8" />
              <h1 className="text-[13px] sm:text-sm font-semibold">CCRelay</h1>
            </div>
            <nav className="flex items-center w-full sm:w-auto">
              <div className="flex w-full sm:w-auto bg-muted/50 sm:bg-transparent rounded-lg sm:rounded-none p-1 sm:p-0 gap-1 sm:gap-0">
                <button
                  className={`flex-1 sm:flex-none h-8 sm:h-10 px-2 sm:px-4 text-[11px] sm:text-xs sm:min-w-[80px] flex items-center justify-center gap-1.5 rounded-md sm:rounded-none transition-all duration-200 ${
                    activeTab === "dashboard"
                      ? "bg-background sm:bg-primary text-foreground sm:text-primary-foreground shadow-sm sm:shadow-none"
                      : "text-muted-foreground sm:text-foreground hover:text-foreground sm:hover:bg-primary/15"
                  }`}
                  onClick={() => setActiveTab("dashboard")}
                >
                  <Server className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("nav.dashboard")}</span>
                </button>
                <button
                  className={`flex-1 sm:flex-none h-8 sm:h-10 px-2 sm:px-4 text-[11px] sm:text-xs sm:min-w-[80px] flex items-center justify-center gap-1.5 rounded-md sm:rounded-none transition-all duration-200 ${
                    activeTab === "providers"
                      ? "bg-background sm:bg-primary text-foreground sm:text-primary-foreground shadow-sm sm:shadow-none"
                      : "text-muted-foreground sm:text-foreground hover:text-foreground sm:hover:bg-primary/15"
                  }`}
                  onClick={() => setActiveTab("providers")}
                >
                  <Activity className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("nav.providers")}</span>
                </button>
                {loggingEnabled && (
                  <button
                    className={`flex-1 sm:flex-none h-8 sm:h-10 px-2 sm:px-4 text-[11px] sm:text-xs sm:min-w-[80px] flex items-center justify-center gap-1.5 rounded-md sm:rounded-none transition-all duration-200 ${
                      activeTab === "logs"
                        ? "bg-background sm:bg-primary text-foreground sm:text-primary-foreground shadow-sm sm:shadow-none"
                        : "text-muted-foreground sm:text-foreground hover:text-foreground sm:hover:bg-primary/15"
                    }`}
                    onClick={() => setActiveTab("logs")}
                  >
                    <Database className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t("nav.logs")}</span>
                  </button>
                )}
                <button
                  className={`flex-1 sm:flex-none h-8 sm:h-10 px-2 sm:px-4 text-[11px] sm:text-xs sm:min-w-[80px] flex items-center justify-center gap-1.5 rounded-md sm:rounded-none transition-all duration-200 ${
                    activeTab === "settings"
                      ? "bg-background sm:bg-primary text-foreground sm:text-primary-foreground shadow-sm sm:shadow-none"
                      : "text-muted-foreground sm:text-foreground hover:text-foreground sm:hover:bg-primary/15"
                  }`}
                  onClick={() => setActiveTab("settings")}
                >
                  <SettingsIcon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("nav.settings")}</span>
                </button>
              </div>
            </nav>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 sm:px-4 py-3 [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch]">
        {activeTab === "dashboard" && <Dashboard />}
        {activeTab === "providers" && <Providers />}
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
          {version && <span className="text-[11px] text-muted-foreground">{version}</span>}
        </div>
      </footer>

      <LanguageModal open={showLangModal} onOpenChange={setShowLangModal} />
    </div>
  );
}

export default App;
