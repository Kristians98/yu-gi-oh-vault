"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/login/actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="login__form">
      <label className="login__field">
        <span>Email</span>
        <input name="email" type="email" defaultValue="you@vault.gg" autoComplete="username" required />
      </label>
      <label className="login__field">
        <span>Password</span>
        <input name="password" type="password" defaultValue="duelist" autoComplete="current-password" required />
      </label>
      {error && (
        <p className="login__error" role="alert">
          {error}
        </p>
      )}
      <button className="login__submit" type="submit" disabled={pending}>
        {pending ? "Entering…" : "Enter the Vault"}
      </button>
    </form>
  );
}
