import { useState } from "react";
import { hasSupabaseEnv, supabase } from "../lib/supabase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!hasSupabaseEnv || !supabase) {
      setError("Supabase URL or anon key is missing. Add them to .env.local first.");
      return;
    }

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (signInError) {
      setError(signInError.message || "Login failed.");
      return;
    }

    setSuccess("Signed in successfully.");
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-head">
          <div className="badge badge-auth">Secure dashboard</div>
          <h1>RetailPOS Mobile</h1>
          <p>Sign in to view your store dashboard from anywhere.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="login-email">Email / Login ID</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@example.com"
            />
          </div>

          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error ? <div className="card message error">{error}</div> : null}
          {success ? <div className="card message success">{success}</div> : null}

          <button className="btn btn-primary auth-submit" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
