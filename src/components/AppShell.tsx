"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createBackend, type Backend } from "../lib/backend";
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

  useEffect(() => {
    const stop = backend.subscribe((next) => {
      setUser(next);
      setReady(true);
    });
    return () => stop();
  }, [backend]);

  return (
    <TableContext.Provider value={{ backend, user, ready }}>
      <div className="app">
        <header className="topbar">
          <Link className="brand" href="/">
            <span>Table</span>
          </Link>
          <nav>
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
        {children}
      </div>
    </TableContext.Provider>
  );
}
