"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatActivityTime } from "../lib/activity";
import { fileVisibilityLabel, formatFileSize } from "../lib/files";
import { presenceLabel } from "../lib/presence";
import { joinPolicyLabel, seatsRemaining } from "../lib/tables";
import type {
  ActivityDoc,
  FileDoc,
  FileVisibility,
  JoinPolicy,
  MemberDoc,
  NoticeDoc,
  PresenceDoc,
  TableDoc,
} from "../lib/types";
import { useTableApp } from "./AppShell";

export function TableRoom() {
  const params = useSearchParams();
  const tableId = params.get("id") ?? "";
  const { backend, user, ready } = useTableApp();
  const router = useRouter();
  const [table, setTable] = useState<TableDoc | null>(null);
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [notices, setNotices] = useState<NoticeDoc[]>([]);
  const [files, setFiles] = useState<FileDoc[]>([]);
  const [activity, setActivity] = useState<ActivityDoc[]>([]);
  const [presence, setPresence] = useState<PresenceDoc[]>([]);
  const [me, setMe] = useState<MemberDoc | null>(null);
  const [rename, setRename] = useState("");
  const [seatLimit, setSeatLimit] = useState("4");
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>("inviteOnly");
  const [displayName, setDisplayName] = useState("");
  const [seatNote, setSeatNote] = useState("");
  const [email, setEmail] = useState("");
  const [noticeSubject, setNoticeSubject] = useState("");
  const [noticeBody, setNoticeBody] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadVisibility, setUploadVisibility] = useState<FileVisibility>("private");
  const [uploadSharedWith, setUploadSharedWith] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || !user || !tableId) return;
    setMessage("");
    setLive(false);
    const unsub = backend.subscribeTableRoom(tableId, (snapshot, error) => {
      if (error || !snapshot) {
        setTable(null);
        setMembers([]);
        setNotices([]);
        setFiles([]);
        setActivity([]);
        setPresence([]);
        setMe(null);
        setLive(false);
        setMessage(error?.message || "Could not open this table.");
        return;
      }
      setTable(snapshot.table);
      setMembers(snapshot.members);
      setNotices(snapshot.notices);
      setFiles(snapshot.files);
      setActivity(snapshot.activity);
      setPresence(snapshot.presence);
      setMe(snapshot.me);
      setRename(snapshot.table.name);
      setSeatLimit(String(snapshot.table.seatLimit));
      setJoinPolicy(snapshot.table.joinPolicy);
      setDisplayName(snapshot.me.displayName);
      setSeatNote(snapshot.me.seatNote);
      setEmail(snapshot.me.email || user.email || "");
      setLive(true);
    });
    return () => {
      unsub();
    };
  }, [backend, ready, user, tableId]);

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
              {table.archived ? " · archived" : ""}
              {live ? " · live" : ""}
            </p>
            {table.archived ? (
              <p className="status">
                This table is archived. Joining is paused until the owner restores it.
              </p>
            ) : null}
            <p className="muted">Join code</p>
            <div className="copy-row">
              <p className="mono" style={{ margin: 0 }}>
                {table.joinCode || "—"}
              </p>
              {table.joinCode ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(table.joinCode).then(
                      () => setMessage("Join code copied."),
                      () => setMessage("Could not copy the join code."),
                    );
                  }}
                >
                  Copy code
                </button>
              ) : null}
            </div>
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
                () => backend.updateTableSettings(table.id, rename, Number(seatLimit), joinPolicy),
                "Table settings saved.",
              );
            }}
          >
            <label>
              Table name
              <input value={rename} onChange={(event) => setRename(event.target.value)} maxLength={40} required />
            </label>
            <label>
              Seat limit
              <input
                type="number"
                min={table.memberCount}
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
                  name="roomJoinPolicy"
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
                  name="roomJoinPolicy"
                  checked={joinPolicy === "firstComeFirstServe"}
                  onChange={() => setJoinPolicy("firstComeFirstServe")}
                />
                <span>
                  <strong>First come, first serve</strong>
                  <span className="muted"> Anyone with the code can take an open seat.</span>
                </span>
              </label>
            </fieldset>
            <div className="row">
              <button type="submit" disabled={busy}>
                Save settings
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    await backend.rotateJoinCode(table.id);
                  }, "New join code is ready. Copy it above.");
                }}
              >
                New join code
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">
            {table.joinPolicy === "inviteOnly"
              ? "This table is invite only. Share the join code only with people you want here."
              : "Open seats go to whoever enters the join code first."}
          </p>
        )}
      </section>

      <section className="panel stack">
        <h2>Here now</h2>
        <p className="muted">{presenceLabel(presence.length)}</p>
        {presence.length > 0 ? (
          <ul className="presence-list">
            {presence.map((person) => (
              <li key={person.uid}>
                <span>{person.displayName}</span>
                {person.uid === me.uid ? <span className="muted">you</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="panel stack">
        <h2>What’s happening</h2>
        <p className="muted">Updates show here as people join, leave, or send notices.</p>
        {activity.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="activity-list">
            {activity.slice(0, 30).map((item) => (
              <li key={item.id}>
                <span>{item.summary}</span>
                <span className="muted">{formatActivityTime(item.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
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
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={40}
              required
            />
          </label>
          <label>
            Seat note
            <textarea
              value={seatNote}
              onChange={(event) => setSeatNote(event.target.value)}
              maxLength={500}
              placeholder="What you’re bringing, or a short note for the table"
            />
          </label>
          <label>
            Email for reminders
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <button type="submit" disabled={busy}>
            Save seat
          </button>
        </form>
        {me.role !== "owner" ? (
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
        <p className="muted">
          {recipientReady === 0
            ? "No one has a reminder email yet."
            : `${recipientReady} inbox${recipientReady === 1 ? "" : "es"} ready.`}
        </p>
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
        <h2>Files</h2>
        <p className="muted">
          Upload an image or PDF up to 5 MB. Keep it only for you, open it to the whole table, or share
          it with people you choose.
        </p>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!uploadFile) {
              setMessage("Choose a file first.");
              return;
            }
            void run(async () => {
              await backend.uploadFile(table.id, uploadFile, uploadVisibility, uploadSharedWith);
              setUploadFile(null);
              setUploadVisibility("private");
              setUploadSharedWith([]);
            }, "File uploaded.");
          }}
        >
          <label>
            Choose file
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <fieldset className="join-policy">
            <legend>Who can open it</legend>
            <label className="choice">
              <input
                type="radio"
                name="fileVisibility"
                checked={uploadVisibility === "private"}
                onChange={() => {
                  setUploadVisibility("private");
                  setUploadSharedWith([]);
                }}
              />
              <span>
                <strong>Only you</strong>
              </span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name="fileVisibility"
                checked={uploadVisibility === "table"}
                onChange={() => {
                  setUploadVisibility("table");
                  setUploadSharedWith([]);
                }}
              />
              <span>
                <strong>Everyone at this table</strong>
              </span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name="fileVisibility"
                checked={uploadVisibility === "shared"}
                onChange={() => setUploadVisibility("shared")}
              />
              <span>
                <strong>Shared with selected people</strong>
              </span>
            </label>
          </fieldset>
          {uploadVisibility === "shared" ? (
            <div className="stack">
              <p className="muted">Choose who else can open it:</p>
              {members
                .filter((member) => member.uid !== me.uid)
                .map((member) => (
                  <label className="choice" key={member.uid}>
                    <input
                      type="checkbox"
                      checked={uploadSharedWith.includes(member.uid)}
                      onChange={(event) => {
                        setUploadSharedWith((current) =>
                          event.target.checked
                            ? [...current, member.uid]
                            : current.filter((uid) => uid !== member.uid),
                        );
                      }}
                    />
                    <span>{member.displayName}</span>
                  </label>
                ))}
            </div>
          ) : null}
          <button type="submit" disabled={busy || !uploadFile}>
            Upload file
          </button>
        </form>
        {files.length === 0 ? (
          <p className="muted">No files you can open yet.</p>
        ) : (
          <div className="stack file-list">
            {files.map((file) => {
              const owner = members.find((member) => member.uid === file.ownerId);
              const mine = file.ownerId === me.uid;
              return (
                <article className="file-card" key={file.id}>
                  <header>
                    <strong>{file.name}</strong>
                    <span className="muted">{formatFileSize(file.size)}</span>
                  </header>
                  <p className="muted">
                    {fileVisibilityLabel(file.visibility)}
                    {owner ? ` · from ${owner.displayName}` : ""}
                  </p>
                  <div className="row">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        void run(() => backend.openFile(table.id, file.id), "Opening file…");
                      }}
                    >
                      Open
                    </button>
                    {mine ? (
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          void run(() => backend.deleteFile(table.id, file.id), "File deleted.");
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                  {mine ? (
                    <form
                      className="stack"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        const nextVisibility = String(form.get("visibility") || "private") as FileVisibility;
                        const nextShared = members
                          .filter((member) => member.uid !== me.uid && form.get(`share-${member.uid}`) === "on")
                          .map((member) => member.uid);
                        void run(
                          () => backend.updateFileSharing(table.id, file.id, nextVisibility, nextShared),
                          "Sharing updated.",
                        );
                      }}
                    >
                      <label>
                        Change who can open it
                        <select name="visibility" defaultValue={file.visibility}>
                          <option value="private">Only you</option>
                          <option value="table">Everyone at this table</option>
                          <option value="shared">Shared with selected people</option>
                        </select>
                      </label>
                      <div className="stack">
                        {members
                          .filter((member) => member.uid !== me.uid)
                          .map((member) => (
                            <label className="choice" key={member.uid}>
                              <input
                                type="checkbox"
                                name={`share-${member.uid}`}
                                defaultChecked={file.sharedWith.includes(member.uid)}
                              />
                              <span>{member.displayName}</span>
                            </label>
                          ))}
                      </div>
                      <button type="submit" className="secondary" disabled={busy}>
                        Save sharing
                      </button>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
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

      <section className="panel stack">
        <h2>Export</h2>
        <p className="muted">
          Download a JSON copy of this table’s seats, notices, activity, and file list for your records.
        </p>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              const result = await backend.exportTable(table.id);
              setMessage(`Downloaded ${result.filename}.`);
            }, "Export ready.");
          }}
        >
          Download table data
        </button>
      </section>

      {me.role === "owner" ? (
        <section className="panel stack">
          <h2>{table.archived ? "Archived table" : "Share this table"}</h2>
          {table.archived ? (
            <p className="muted">
              Restore to make the join code work again, or delete forever when you are done with it.
            </p>
          ) : (
            <p className="muted">
              {seatsRemaining(table) === 0
                ? "This table is full. Raise the seat limit before sharing the code again."
                : "Send people the join code above. They sign in, enter the code on the home page, and take a seat. Archive puts the table away without deleting seats."}
            </p>
          )}
          <div className="row">
            {table.archived ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void run(() => backend.restoreTable(table.id), "Table restored.");
                }}
              >
                Restore table
              </button>
            ) : (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  void run(() => backend.archiveTable(table.id), "Table archived.");
                }}
              >
                Archive table
              </button>
            )}
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    table.archived
                      ? "Delete this archived table and every seat forever?"
                      : "Delete this table and every seat forever? Prefer Archive if you might need it later.",
                  )
                ) {
                  return;
                }
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
              Delete forever
            </button>
          </div>
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
