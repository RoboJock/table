"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { joinPolicyLabel, seatsRemaining } from "../lib/tables";
import type { JoinPolicy, MemberDoc, NoticeDoc, TableDoc } from "../lib/types";
import { useTableApp } from "./AppShell";

export function TableRoom() {
  const params = useSearchParams();
  const tableId = params.get("id") ?? "";
  const { backend, user, ready } = useTableApp();
  const router = useRouter();
  const [table, setTable] = useState<TableDoc | null>(null);
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [notices, setNotices] = useState<NoticeDoc[]>([]);
  const [me, setMe] = useState<MemberDoc | null>(null);
  const [rename, setRename] = useState("");
  const [seatLimit, setSeatLimit] = useState("4");
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>("inviteOnly");
  const [displayName, setDisplayName] = useState("");
  const [seatNote, setSeatNote] = useState("");
  const [email, setEmail] = useState("");
  const [inviteUid, setInviteUid] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [noticeSubject, setNoticeSubject] = useState("");
  const [noticeBody, setNoticeBody] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!tableId) return;
    const opened = await backend.openTable(tableId);
    setTable(opened.table);
    setMembers(opened.members);
    setNotices(opened.notices);
    setMe(opened.me);
    setRename(opened.table.name);
    setSeatLimit(String(opened.table.seatLimit));
    setJoinPolicy(opened.table.joinPolicy);
    setDisplayName(opened.me.displayName);
    setSeatNote(opened.me.seatNote);
    setEmail(opened.me.email || user?.email || "");
  }, [backend, tableId, user?.email]);

  useEffect(() => {
    if (!ready) return;
    if (!user) return;
    if (!tableId) return;
    setMessage("");
    void reload().catch((error: unknown) => {
      setTable(null);
      setMembers([]);
      setNotices([]);
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

  const recipientReady = members.filter((member) => member.email.trim()).length;

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2>{table.name}</h2>
            <p className="muted">
              {joinPolicyLabel(table.joinPolicy)} · {table.memberCount}/{table.seatLimit} seats filled
              {seatsRemaining(table) === 0 ? " · full" : ` · ${seatsRemaining(table)} open`}
            </p>
            <p className="muted">Table id</p>
            <p className="mono">{table.id}</p>
          </div>
          <Link className="button secondary" href="/">
            All tables
          </Link>
        </div>
        {me.role === "owner" ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  backend.updateTableSettings(table.id, rename, Number(seatLimit), joinPolicy),
                "Table settings saved.",
              );
            }}
          >
            <label>
              Table name
              <input value={rename} onChange={(event) => setRename(event.target.value)} maxLength={40} />
            </label>
            <label>
              Seat limit
              <input
                type="number"
                min={table.memberCount}
                max={40}
                value={seatLimit}
                onChange={(event) => setSeatLimit(event.target.value)}
              />
            </label>
            <fieldset className="join-policy">
              <legend>Who can sit</legend>
              <label className="choice">
                <input
                  type="radio"
                  name="roomJoinPolicy"
                  checked={joinPolicy === "inviteOnly"}
                  onChange={() => setJoinPolicy("inviteOnly")}
                />
                <span>
                  <strong>Invite only</strong>
                </span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="roomJoinPolicy"
                  checked={joinPolicy === "firstComeFirstServe"}
                  onChange={() => setJoinPolicy("firstComeFirstServe")}
                />
                <span>
                  <strong>First come, first serve</strong>
                </span>
              </label>
            </fieldset>
            <button type="submit" className="secondary" disabled={busy}>
              Save settings
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
            void run(
              () => backend.updateSeat(table.id, displayName, seatNote, email),
              "Seat saved.",
            );
          }}
        >
          <label>
            Display name
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} required />
          </label>
          <label>
            Email for reminders
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              placeholder="Where reminders for this table should go"
            />
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
        <h2>Send a notice</h2>
        <p className="muted">Send out an email reminder for people at this table.</p>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void (async () => {
              setBusy(true);
              setMessage("");
              try {
                const result = await backend.sendNotice(table.id, noticeSubject, noticeBody);
                setNoticeSubject("");
                setNoticeBody("");
                await reload();
                setMessage(
                  `Notice sent to ${result.recipientCount} inbox${result.recipientCount === 1 ? "" : "es"}.`,
                );
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "That action failed.");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <label>
            Subject
            <input
              value={noticeSubject}
              onChange={(event) => setNoticeSubject(event.target.value)}
              maxLength={120}
              required
              placeholder="Thursday review at 7"
            />
          </label>
          <label>
            Message
            <textarea
              value={noticeBody}
              onChange={(event) => setNoticeBody(event.target.value)}
              maxLength={2000}
              required
              placeholder="Short note for everyone at this table"
            />
          </label>
          <button type="submit" disabled={busy || recipientReady === 0}>
            Send notice
          </button>
        </form>
        {notices.length > 0 ? (
          <div className="stack notice-list">
            <h3>Recent notices</h3>
            {notices.map((notice) => {
              const sender = members.find((member) => member.uid === notice.sentBy);
              return (
                <article className="notice-card" key={notice.id}>
                  <header>
                    <strong>{notice.subject}</strong>
                    <span className="muted">
                      {new Date(notice.sentAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </header>
                  <p>{notice.body}</p>
                  <p className="muted">
                    From {sender?.displayName ?? "a member"} · to {notice.to.length} address
                    {notice.to.length === 1 ? "" : "es"}
                  </p>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="muted">No notices sent yet.</p>
        )}
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
              <p className="muted">{member.email ? "Gets email reminders" : "No reminder email yet"}</p>
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
            {seatsRemaining(table) === 0
              ? "This table is full. Raise the seat limit before inviting someone else."
              : "Ask the other person to sign in and send you their account id from the home page. Paste it here. They can add an email for reminders after they join."}
          </p>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  backend.inviteMember(table.id, inviteUid, inviteName).then(() => {
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
            <button type="submit" disabled={busy || seatsRemaining(table) === 0}>
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
                  notices.map((notice) => notice.id),
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
