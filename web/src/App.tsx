import { useState, useEffect } from "react";
import { Activity, Server, Database } from "lucide-react";
import { api } from "./api/client";
import Dashboard from "./features/dashboard/Dashboard";

// CCRelay icon as data URI (works in VSCode webview)
const iconSvg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'%3E%3Cdefs%3E%3ClinearGradient id='purpleGradient' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%239B59B6;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%238E44AD;stop-opacity:1' /%3E%3C/linearGradient%3E%3ClinearGradient id='grayGradient' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%2395A5A6;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%237F8C8D;stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='64' cy='64' r='56' fill='%232C3E50' opacity='0.1'/%3E%3Cpath d='M 32 75 Q 32 45 50 45 L 64 45' stroke='url(%23purpleGradient)' stroke-width='10' stroke-linecap='round' fill='none'/%3E%3Cpath d='M 52 35 L 66 45 L 52 55' fill='url(%23purpleGradient)' stroke='url(%23purpleGradient)' stroke-width='3' stroke-linejoin='round'/%3E%3Cpath d='M 96 53 Q 96 83 78 83 L 64 83' stroke='url(%23grayGradient)' stroke-width='10' stroke-linecap='round' fill='none'/%3E%3Cpath d='M 76 93 L 62 83 L 76 73' fill='url(%23grayGradient)' stroke='url(%23grayGradient)' stroke-width='3' stroke-linejoin='round'/%3E%3Ccircle cx='64' cy='64' r='8' fill='url(%23purpleGradient)'/%3E%3Ccircle cx='64' cy='64' r='4' fill='%23FFFFFF'/%3E%3Cline x1='22' y1='64' x2='32' y2='64' stroke='%237F8C8D' stroke-width='4' stroke-linecap='round'/%3E%3Cline x1='96' y1='64' x2='106' y2='64' stroke='%237F8C8D' stroke-width='4' stroke-linecap='round'/%3E%3Ccircle cx='18' cy='64' r='4' fill='%2395A5A6'/%3E%3Ccircle cx='110' cy='64' r='4' fill='%2395A5A6'/%3E%3C/svg%3E`;
import Providers from "./features/providers/Providers";
import Logs from "./features/logs/Logs";

type Tab = "dashboard" | "providers" | "logs";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    api
      .getVersion()
      .then(v => setVersion(v.version))
      .catch(() => {});
  }, []);

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header - Tab Style */}
      <header className="bg-card flex-shrink-0 border-b">
        <div className="max-w-full px-2 sm:px-4">
          <div className="flex h-10 items-center justify-between">
            <div className="flex items-center gap-1.5">
              <img src={iconSvg} alt="CCRelay" className="h-8 w-8" />
              <h1 className="text-sm font-semibold">CCRelay</h1>
            </div>
            <nav className="flex items-center justify-center">
              <div className="flex">
                <button
                  className={`h-10 px-4 text-xs min-w-[80px] flex items-center justify-center gap-1 rounded-none transition-colors duration-200 ${
                    activeTab === "dashboard"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-primary/15"
                  }`}
                  onClick={() => setActiveTab("dashboard")}
                >
                  <Server className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline ml-1">Dashboard</span>
                </button>
                <button
                  className={`h-10 px-4 text-xs min-w-[80px] flex items-center justify-center gap-1 rounded-none transition-colors duration-200 ${
                    activeTab === "providers"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-primary/15"
                  }`}
                  onClick={() => setActiveTab("providers")}
                >
                  <Activity className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline ml-1">Providers</span>
                </button>
                <button
                  className={`h-10 px-4 text-xs min-w-[80px] flex items-center justify-center gap-1 rounded-none transition-colors duration-200 ${
                    activeTab === "logs"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-primary/15"
                  }`}
                  onClick={() => setActiveTab("logs")}
                >
                  <Database className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline ml-1">Logs</span>
                </button>
              </div>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content - Each component handles its own scroll */}
      <main className="flex-1 min-h-0 px-2 sm:px-4 py-3">
        {activeTab === "dashboard" && <Dashboard />}
        {activeTab === "providers" && <Providers />}
        {activeTab === "logs" && <Logs />}
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
            Project CCRelay
          </p>
          {version && <span className="text-[11px] text-muted-foreground">{version}</span>}
        </div>
      </footer>
    </div>
  );
}

export default App;
