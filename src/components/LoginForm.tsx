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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (ready && user) {
    return (
      <div className="login-page">
        <section className="panel stack login-card">
          <h2>Signed in</h2>
          <p className="muted">
            You are {user.name}. Your account id is what an owner pastes when they invite you.
          </p>
          <p className="mono">{user.id}</p>
          <div className="row login-actions">
            <button type="button" onClick={() => router.push("/")}>
              Go to your tables
            </button>
            <button type="button" className="secondary" onClick={() => void backend.signOut()}>
              Sign out
            </button>
          </div>
        </section>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "create") {
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        await backend.register(email, password, name);
      } else {
        await backend.signIn(email, password);
      }
      setPassword("");
      setConfirmPassword("");
      router.push("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="panel stack login-card">
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
          <button
            type="button"
            className={mode === "create" ? "on" : ""}
            onClick={() => {
              setMode("create");
              setMessage("");
            }}
          >
            Create account
          </button>
          <button
            type="button"
            className={mode === "signin" ? "on" : ""}
            onClick={() => {
              setMode("signin");
              setMessage("");
              setConfirmPassword("");
            }}
          >
            Sign in
          </button>
        </div>
        <form className="stack login-form" onSubmit={(event) => void submit(event)}>
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
            <span className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete={mode === "create" ? "new-password" : "current-password"}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </span>
          </label>
          {mode === "create" ? (
            <label>
              Confirm password
              <span className="password-field">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"}
                  aria-pressed={showConfirmPassword}
                  onClick={() => setShowConfirmPassword((value) => !value)}
                >
                  {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </span>
            </label>
          ) : null}
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
    </div>
  );
}

function EyeIcon() {
  return (
    <svg className="password-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="password-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3l18 18M9.9 5.1A10.4 10.4 0 0 1 12 4.5c6 0 9.5 7.5 9.5 7.5a16.7 16.7 0 0 1-3.2 3.8M6.1 6.1C3.9 7.7 2.5 12 2.5 12S6 18.5 12 18.5c1.1 0 2.1-.2 3-.5"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.9 9.9A3 3 0 0 0 12 15a3 3 0 0 0 2.1-.9"
      />
    </svg>
  );
}
