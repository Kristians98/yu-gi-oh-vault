import { googleSignIn } from "@/lib/auth-actions";

/** "Continue with Google" — a plain form posting to a server action, so it needs no JS.
 *  `invite` (from /signup?invite=…) rides along so a new Google user redeems it. */
export function GoogleButton({ invite, label = "Continue with Google" }: { invite?: string; label?: string }) {
  return (
    <form action={googleSignIn} className="login__oauth">
      <input type="hidden" name="invite" value={invite ?? ""} />
      <button className="login__google" type="submit">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
          <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
          <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
        </svg>
        {label}
      </button>
    </form>
  );
}

export function OrDivider() {
  return (
    <div className="login__divider" aria-hidden="true">
      <span>or</span>
    </div>
  );
}
