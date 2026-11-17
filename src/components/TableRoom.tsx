"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { MemberDoc, TableDoc } from "../lib/types";
import { useTableApp } from "./AppShell";

export function TableRoom() {
  const params = useSearchParams();
  const tableId = params.get("id") ?? "";
  const { backend, user, ready } = useTableApp();
  const router = useRouter();
  const [table, setTable] = useState<TableDoc | null>(null);
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [me, setMe] = useState<MemberDoc | null>(null);
  const [rename, setRename] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [seatNote, setSeatNote] = useState("");
  const [inviteUid, setInviteUid] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!tableId) return;
    const opened = await backend.openTable(tableId);
    setTable(opened.table);
    setMembers(opened.members);
    setMe(opened.me);
    setRename(opened.table.name);
    setDisplayName(opened.me.displayName);
    setSeatNote(opened.me.seatNote);
  }, [backend, tableId]);

  useEffect(() => {
    if (!ready) return;
    if (!user) return;
    if (!tableId) return;
    setMessage("");
    void reload().catch((error: unknown) => {
      setTable(null);
      setMembers([]);
      setMe(null);
      setMessage(error instanceof Error ? error.message : "Could not open this table.");
    });
  }, [ready, user, tableId, reload]);

  if (!tableId) {
    return (
      <section className="panel">
        <p className="status">Choose a table from the home page.</p>
        <Link href="/">Back</Link>
      </section>
    );
  }

  if (!ready) return <p className="status">Loading…</p>;

  if (!user) {
    return (
      <section className="panel stack">
        <h2>Sign in required</h2>
        <p className="muted">Signed-out visitors cannot read tables.</p>
        <Link className="button" href="/login">
          Sign in
        </Link>
      </section>
    );
  }

  if (!table || !me) {
    return (
      <section className="panel stack">
        <h2>Table</h2>
        <p className="status" role="status">
          {message || "Opening…"}
        </p>
        <Link href="/">Back to your tables</Link>
      </section>
    );
  }

  async function run(action: () => Promise<void>, ok: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await reload();
      setMessage(ok);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2>{table.name}</h2>
            <p className="muted">Table id</p>
            <p className="mono">{table.id}</p>
          </div>
          <Link className="button secondary" href="/">
            All tables
          </Link>
        </div>
        {me.role === "owner" ? (
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => backend.renameTable(table.id, rename), "Table renamed.");
            }}
          >
            <label style={{ flex: 1, minWidth: "14rem" }}>
              Rename
              <input value={rename} onChange={(event) => setRename(event.target.value)} maxLength={40} />
            </label>
            <button type="submit" className="secondary" disabled={busy}>
              Save name
            </button>
          </form>
        ) : null}
      </section>

      <section className="panel stack">
        <h2>Your seat</h2>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => backend.updateSeat(table.id, displayName, seatNote), "Seat saved.");
          }}
        >
          <label>
            Display name
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} required />
          </label>
          <label>
            Seat note
            <textarea
              value={seatNote}
              onChange={(event) => setSeatNote(event.target.value)}
              maxLength={500}
              placeholder="What you are bringing, playing, or tracking"
            />
          </label>
          <button type="submit" disabled={busy}>
            Save seat
          </button>
        </form>
        {me.role === "member" ? (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                await backend.leaveTable(table.id);
                router.push("/");
              }, "You left the table.");
            }}
          >
            Leave table
          </button>
        ) : null}
      </section>

      <section className="panel stack">
        <h2>Members</h2>
        <div className="member-grid">
          {members.map((member) => (
            <article className="member-card" key={member.uid}>
              <header>
                <h3>{member.displayName}</h3>
                <span className={`pill ${member.role}`}>{member.role}</span>
              </header>
              <p className="muted">{member.seatNote || "No seat note yet."}</p>
              <p className="mono">{member.uid}</p>
              {me.role === "owner" && member.role !== "owner" ? (
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    void run(() => backend.removeMember(table.id, member.uid), "Member removed.");
                  }}
                >
                  Remove
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {me.role === "owner" ? (
        <section className="panel stack">
          <h2>Invite</h2>
          <p className="muted">
            Ask the other person to sign in and send you their account id from the home page. Paste it
            here. No email lookup without a server.
          </p>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () => backend.inviteMember(table.id, inviteUid, inviteName).then(() => {
                  setInviteUid("");
                  setInviteName("");
                }),
                "Invite saved. They can open this table id after signing in.",
              );
            }}
          >
            <label>
              Account id
              <input value={inviteUid} onChange={(event) => setInviteUid(event.target.value)} required />
            </label>
            <label>
              Display name for their seat
              <input
                value={inviteName}
                onChange={(event) => setInviteName(event.target.value)}
                placeholder="Optional"
                maxLength={40}
              />
            </label>
            <button type="submit" disabled={busy}>
              Invite member
            </button>
          </form>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Delete this table and every seat?")) return;
              void run(async () => {
                await backend.deleteTable(
                  table.id,
                  members.map((member) => member.uid),
                );
                router.push("/");
              }, "Table deleted.");
            }}
          >
            Delete table
          </button>
        </section>
      ) : null}

      {message ? (
        <p className="status" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
