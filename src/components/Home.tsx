"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readRecentTableIds } from "../lib/tables";
import type { TableDoc } from "../lib/types";
import { useTableApp } from "./AppShell";

export function Home() {
  const { backend, user, ready } = useTableApp();
  const router = useRouter();
  const [owned, setOwned] = useState<TableDoc[]>([]);
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || !user) {
      setOwned([]);
      setRecent([]);
      return;
    }
    setRecent(readRecentTableIds(user.id));
    void backend
      .listOwnedTables()
      .then(setOwned)
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Could not load tables.");
      });
  }, [backend, ready, user]);

  if (!ready) return <p className="status">Loading…</p>;

  if (!user) {
    return (
      <section className="hero panel">
        <h1>A shared table for a small group</h1>
        <p className="lede">
          Create a table, invite people by account id, and let each member edit only their own seat.
          Signed-out visitors and strangers get nothing.
        </p>
        <Link className="button" href="/login">
          Sign in to start
        </Link>
      </section>
    );
  }

  async function createTable(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const table = await backend.createTable(name);
      setName("");
      router.push(`/table?id=${encodeURIComponent(table.id)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the table.");
    } finally {
      setBusy(false);
    }
  }

  function openTable(event: React.FormEvent) {
    event.preventDefault();
    const id = openId.trim();
    if (!id) {
      setMessage("Paste a table id first.");
      return;
    }
    router.push(`/table?id=${encodeURIComponent(id)}`);
  }

  return (
    <div className="stack">
      <section className="hero panel">
        <h1>Your tables</h1>
        <p className="lede">
          Signed in as {user.name}. Share your account id when someone invites you:
        </p>
        <p className="mono">{user.id}</p>
      </section>

      <section className="panel stack">
        <h2>Create a table</h2>
        <form className="stack" onSubmit={(event) => void createTable(event)}>
          <label>
            Table name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Friday campaign"
              required
              maxLength={40}
            />
          </label>
          <button type="submit" disabled={busy}>
            Create table
          </button>
        </form>
      </section>

      <section className="panel stack">
        <h2>Open a table</h2>
        <p className="muted">
          Owners see their tables below. Invited members open the table id the owner shared.
        </p>
        <form className="stack" onSubmit={openTable}>
          <label>
            Table id
            <input value={openId} onChange={(event) => setOpenId(event.target.value)} placeholder="Paste an id" />
          </label>
          <button type="submit" className="secondary">
            Open
          </button>
        </form>
        {recent.length ? (
          <div className="stack">
            <p className="muted">Recent on this browser</p>
            <ul className="table-list">
              {recent.map((id) => (
                <li key={id}>
                  <Link href={`/table?id=${encodeURIComponent(id)}`}>
                    <strong>Open again</strong>
                    <span className="mono">{id}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="panel stack">
        <h2>Tables you own</h2>
        {owned.length === 0 ? (
          <p className="muted">None yet. Create one above.</p>
        ) : (
          <ul className="table-list">
            {owned.map((table) => (
              <li key={table.id}>
                <Link href={`/table?id=${encodeURIComponent(table.id)}`}>
                  <strong>{table.name}</strong>
                  <span className="mono">{table.id}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {message ? (
        <p className="status" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
