import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";

type McpContextValue = {
  app: App | null;
  toolData: unknown;
  error: unknown;
  hostContext?: McpUiHostContext;
  theme: "light" | "dark";
};

const McpContext = createContext<McpContextValue | null>(null);

export function McpAppProvider({ name, children }: { name: string; children: React.ReactNode }) {
  const [toolData, setToolData] = useState<unknown>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext>();

  const { app, error } = useApp({
    appInfo: { name, version: "0.1.0" },
    capabilities: {},
    onAppCreated: (createdApp: App) => {
      createdApp.ontoolresult = async (result: { structuredContent?: unknown }) => {
        setToolData(result.structuredContent ?? null);
      };
      createdApp.onhostcontextchanged = (ctx: McpUiHostContext) => {
        setHostContext((prev) => ({ ...prev, ...ctx }));
      };
      createdApp.onteardown = async () => ({});
      createdApp.onerror = console.error;
    },
  });

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  const value = useMemo<McpContextValue>(() => ({
    app: app ?? null,
    toolData,
    error,
    hostContext,
    theme: hostContext?.theme === "dark" ? "dark" : "light",
  }), [app, toolData, error, hostContext]);

  return <McpContext.Provider value={value}>{children}</McpContext.Provider>;
}

export function useMcpApp() {
  const value = useContext(McpContext);
  if (!value) throw new Error("useMcpApp must be used within McpAppProvider");
  return value;
}

export function useMcpToolData<T>() {
  return useMcpApp().toolData as T | null;
}

export function useMcpTheme() {
  return useMcpApp().theme;
}
