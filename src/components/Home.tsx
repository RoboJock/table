"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { joinPolicyLabel, readRecentTableIds, seatsRemaining } from "../lib/tables";
import type { JoinCodeDoc, JoinPolicy, TableDoc } from "../lib/types";
import { useTableApp } from "./AppShell";

export function Home() {
  const { backend, user, ready } = useTableApp();
  const router = useRouter();
  const [owned, setOwned] = useState<TableDoc[]>([]);
  const [name, setName] = useState("");
  const [seatLimit, setSeatLimit] = useState("4");
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>("inviteOnly");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joinPreview, setJoinPreview] = useState<JoinCodeDoc | null>(null);
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
          Create a table with a seat limit, share a join code, and watch the room update live as
          people sit down.
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
      const table = await backend.createTable(name, Number(seatLimit), joinPolicy);
      setName("");
      router.push(`/table?id=${encodeURIComponent(table.id)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the table.");
    } finally {
      setBusy(false);
    }
  }

  async function lookUpCode(event: React.FormEvent) {
    event.preventDefault();
    const code = joinCodeInput.trim();
    if (!code) {
      setMessage("Enter a join code first.");
      return;
    }
    setBusy(true);
    setMessage("");
    setJoinPreview(null);
    try {
      const peeked = await backend.peekJoinCode(code);
      try {
        const opened = await backend.openTable(peeked.tableId);
        router.push(`/table?id=${encodeURIComponent(opened.table.id)}`);
        return;
      } catch {
        setJoinPreview(peeked);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not look up that code.");
    } finally {
      setBusy(false);
    }
  }

  async function takeSeat() {
    if (!joinPreview) return;
    setBusy(true);
    setMessage("");
    try {
      const joined = await backend.joinWithCode(joinPreview.code);
      router.push(`/table?id=${encodeURIComponent(joined.tableId)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not join that table.");
      try {
        setJoinPreview(await backend.peekJoinCode(joinPreview.code));
      } catch {
        setJoinPreview(null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="hero panel">
        <h1>Your tables</h1>
        <p className="lede">Signed in as {user.name}. Share a table’s join code when you want people in.</p>
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
          <label>
            How many seats
            <input
              type="number"
              min={1}
              max={40}
              value={seatLimit}
              onChange={(event) => setSeatLimit(event.target.value)}
              required
            />
          </label>
          <fieldset className="join-policy">
            <legend>Who can sit</legend>
            <label className="choice">
              <input
                type="radio"
                name="joinPolicy"
                checked={joinPolicy === "inviteOnly"}
                onChange={() => setJoinPolicy("inviteOnly")}
              />
              <span>
                <strong>Invite only</strong>
                <span className="muted"> Share the join code with people you trust.</span>
              </span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name="joinPolicy"
                checked={joinPolicy === "firstComeFirstServe"}
                onChange={() => setJoinPolicy("firstComeFirstServe")}
              />
              <span>
                <strong>First come, first serve</strong>
                <span className="muted"> Anyone with the join code can grab an open seat.</span>
              </span>
            </label>
          </fieldset>
          <button type="submit" disabled={busy}>
            Create table
          </button>
        </form>
      </section>

      <section className="panel stack">
        <h2>Join with a code</h2>
        <p className="muted">
          Enter the 6-character code from the table owner. If you already belong, you go straight in.
        </p>
        <form className="stack" onSubmit={(event) => void lookUpCode(event)}>
          <label>
            Join code
            <input
              value={joinCodeInput}
              onChange={(event) => setJoinCodeInput(event.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <button type="submit" className="secondary" disabled={busy}>
            Look up
          </button>
        </form>
        {joinPreview ? (
          <div className="stack join-preview">
            <p>
              <strong>{joinPreview.name}</strong>
            </p>
            <p className="muted">
              {joinPolicyLabel(joinPreview.joinPolicy)} ·{" "}
              {seatsRemaining({
                ...joinPreview,
                id: joinPreview.tableId,
                joinCode: joinPreview.code,
                createdAt: 0,
              })}{" "}
              of {joinPreview.seatLimit} seats open
            </p>
            {seatsRemaining({
              ...joinPreview,
              id: joinPreview.tableId,
              joinCode: joinPreview.code,
              createdAt: 0,
            }) > 0 ? (
              <button type="button" disabled={busy} onClick={() => void takeSeat()}>
                Take a seat
              </button>
            ) : (
              <p className="status">This table is full.</p>
            )}
          </div>
        ) : null}
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
                  <span className="mono">
                    {table.memberCount}/{table.seatLimit}
                    {table.joinCode ? ` · code ${table.joinCode}` : ""}
                  </span>
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
