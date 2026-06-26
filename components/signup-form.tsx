"use client";

import { useActionState } from "react";
import { registerUser } from "@/lib/auth-actions";

export function SignupForm({ invite }: { invite?: string }) {
  const [error, action, pending] = useActionState(registerUser, undefined);
  return (
    <form action={action} className="login__form">
      <input type="hidden" name="invite" value={invite ?? ""} />
      <label className="login__field">
        <span>Display name</span>
        <input name="displayName" required autoComplete="name" placeholder="Seto Kaiba" />
      </label>
      <label className="login__field">
        <span>Username</span>
        <input name="username" required autoComplete="username" placeholder="kaiba" />
      </label>
      <label className="login__field">
        <span>Email</span>
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label className="login__field">
        <span>Password</span>
        <input name="password" type="password" required minLength={6} autoComplete="new-password" />
      </label>
      {error && (
        <p className="login__error" role="alert">{error}</p>
      )}
      <button className="login__submit" type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
