"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createBackend, type Backend } from "../lib/backend";
import { connectionMessage, type ConnectionState } from "../lib/offline";
import type { AppUser } from "../lib/types";

type Ctx = {
  backend: Backend;
  user: AppUser | null;
  ready: boolean;
};

const TableContext = createContext<Ctx | null>(null);

export function useTableApp() {
  const value = useContext(TableContext);
  if (!value) throw new Error("Table app context is missing.");
  return value;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const backend = useMemo(() => createBackend(), []);
  const [user, setUser] = useState<AppUser | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [connection, setConnection] = useState<ConnectionState>({ online: true, synced: true });

  useEffect(() => {
    const saved = document.documentElement.dataset.theme;
    setTheme(saved === "dark" ? "dark" : "light");
  }, []);

  useEffect(() => {
    const stop = backend.subscribe((next) => {
      setUser(next);
      setReady(true);
    });
    const stopConnection = backend.watchConnection(setConnection);
    return () => {
      stop();
      stopConnection();
    };
  }, [backend]);

  const banner = connectionMessage(connection);

  return (
    <TableContext.Provider value={{ backend, user, ready }}>
      <div className="app">
        <header className="topbar">
          <Link className="brand" href="/">
            <span>Table</span>
          </Link>
          <nav>
            <button
              type="button"
              className="theme-toggle"
              aria-pressed={theme === "dark"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => {
                const next = theme === "dark" ? "light" : "dark";
                setTheme(next);
                document.documentElement.dataset.theme = next;
                localStorage.setItem("table-theme", next);
              }}
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </button>
            {ready && user ? <span className="who">{user.name}</span> : null}
            {ready && user ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  void backend.signOut();
                }}
              >
                Sign out
              </button>
            ) : (
              <Link className="button secondary" href="/login">
                Sign in
              </Link>
            )}
          </nav>
        </header>
        {banner ? (
          <p className="offline-banner" role="status">
            {banner}
          </p>
        ) : null}
        {children}
      </div>
    </TableContext.Provider>
  );
}

function SunIcon() {
  return (
    <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M14.5 3.2a8.2 8.2 0 1 0 6.3 13.2A7.2 7.2 0 0 1 14.5 3.2z" />
    </svg>
  );
}
