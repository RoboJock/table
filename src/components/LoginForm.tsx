"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTableApp } from "./AppShell";

export function LoginForm() {
  const { backend, user, ready } = useTableApp();
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "signin">("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (ready && user) {
    return (
      <section className="panel stack">
        <h2>Signed in</h2>
        <p className="muted">
          You are {user.name}. Your account id is what an owner pastes when they invite you.
        </p>
        <p className="mono">{user.id}</p>
        <div className="row">
          <button type="button" onClick={() => router.push("/")}>
            Go to your tables
          </button>
          <button type="button" className="secondary" onClick={() => void backend.signOut()}>
            Sign out
          </button>
        </div>
      </section>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "create") await backend.register(email, password, name);
      else await backend.signIn(email, password);
      setPassword("");
      router.push("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack">
      <h2>{mode === "create" ? "Create an account" : "Sign in"}</h2>
      <p className="muted">
        Table needs a signed-in account. There is no guest shelf here — membership is the point.
      </p>
      {!backend.configured ? (
        <p className="status" role="status">
          Firebase is not configured yet. Copy `.env.example` to `.env.local` and paste the web app
          config.
        </p>
      ) : null}
      <div className="account-toggle">
        <button type="button" className={mode === "create" ? "on" : ""} onClick={() => setMode("create")}>
          Create account
        </button>
        <button type="button" className={mode === "signin" ? "on" : ""} onClick={() => setMode("signin")}>
          Sign in
        </button>
      </div>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        {mode === "create" ? (
          <label>
            Display name
            <input value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={40} />
          </label>
        ) : null}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            autoComplete={mode === "create" ? "new-password" : "current-password"}
          />
        </label>
        <button type="submit" disabled={busy || !backend.configured}>
          {mode === "create" ? "Create account" : "Sign in"}
        </button>
      </form>
      {message ? (
        <p className="status" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
