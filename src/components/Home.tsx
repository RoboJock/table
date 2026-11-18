"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { joinPolicyLabel, readRecentTableIds, seatsRemaining } from "../lib/tables";
import type { JoinPolicy, TableDoc } from "../lib/types";
import { useTableApp } from "./AppShell";

export function Home() {
  const { backend, user, ready } = useTableApp();
  const router = useRouter();
  const [owned, setOwned] = useState<TableDoc[]>([]);
  const [name, setName] = useState("");
  const [seatLimit, setSeatLimit] = useState("4");
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>("inviteOnly");
  const [openId, setOpenId] = useState("");
  const [joinPreview, setJoinPreview] = useState<TableDoc | null>(null);
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
          Create a table with a seat limit, invite people or open first come first serve seats, and
          let each member edit only their own place.
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

  async function lookUpTable(event: React.FormEvent) {
    event.preventDefault();
    const id = openId.trim();
    if (!id) {
      setMessage("Paste a table id first.");
      return;
    }
    setBusy(true);
    setMessage("");
    setJoinPreview(null);
    try {
      const opened = await backend.openTable(id);
      router.push(`/table?id=${encodeURIComponent(opened.table.id)}`);
    } catch {
      try {
        const peeked = await backend.peekTable(id);
        setJoinPreview(peeked);
        setMessage("");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not open that table.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function joinFirstCome() {
    if (!joinPreview) return;
    setBusy(true);
    setMessage("");
    try {
      await backend.joinTable(joinPreview.id);
      router.push(`/table?id=${encodeURIComponent(joinPreview.id)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not join that table.");
      try {
        setJoinPreview(await backend.peekTable(joinPreview.id));
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
        <p className="lede">
          Signed in as {user.name}. Share your account id when someone invites you:
        </p>
        <div className="copy-row">
          <p className="mono" style={{ margin: 0 }}>
            {user.id}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(user.id).then(
                () => setMessage("Account id copied."),
                () => setMessage("Could not copy the account id."),
              );
            }}
          >
            Copy id
          </button>
        </div>
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
                <span className="muted"> You add people by account id.</span>
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
                <span className="muted"> Anyone with the table id can grab an open seat.</span>
              </span>
            </label>
          </fieldset>
          <button type="submit" disabled={busy}>
            Create table
          </button>
        </form>
      </section>

      <section className="panel stack">
        <h2>Open or join a table</h2>
        <p className="muted">
          Paste a table id. If you already belong, you go in. If it is first come, first serve, you
          can take an open seat.
        </p>
        <form className="stack" onSubmit={(event) => void lookUpTable(event)}>
          <label>
            Table id
            <input value={openId} onChange={(event) => setOpenId(event.target.value)} placeholder="Paste an id" />
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
              {joinPolicyLabel(joinPreview.joinPolicy)} · {seatsRemaining(joinPreview)} of{" "}
              {joinPreview.seatLimit} seats open
            </p>
            {joinPreview.joinPolicy === "firstComeFirstServe" && seatsRemaining(joinPreview) > 0 ? (
              <button type="button" disabled={busy} onClick={() => void joinFirstCome()}>
                Take a seat
              </button>
            ) : joinPreview.joinPolicy === "firstComeFirstServe" ? (
              <p className="status">This table is full.</p>
            ) : (
              <p className="muted">Invite only — ask the owner to add your account id.</p>
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
                    {table.memberCount}/{table.seatLimit} · {table.id}
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
