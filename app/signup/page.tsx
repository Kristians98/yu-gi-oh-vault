import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/auth";
import { SignupForm } from "@/components/signup-form";
import { GoogleButton, OrDivider } from "@/components/google-button";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string; error?: string }> }) {
  const { invite, error } = await searchParams;
  const session = await auth();
  if (session?.user) redirect("/");
  const inviteOnly = process.env.ALLOW_OPEN_SIGNUP !== "true";

  return (
    <main className="login">
      <div className="login__card">
        <div className="login__brand">
          <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" width="40" height="40">
            <path d="M24 4 L44 40 H4 Z" stroke="#d9b45b" strokeWidth="2" strokeLinejoin="round" />
            <path d="M13 29 q11 -11 22 0 q-11 9 -22 0 Z" fill="#0a0710" stroke="#f2d488" strokeWidth="1.6" />
            <circle cx="24" cy="28.5" r="3.4" fill="#f2d488" />
            <path d="M24 32 v5 M19 32 l-2.5 4 M29 32 l2.5 4" stroke="#d9b45b" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span>THE VAULT</span>
        </div>
        <p className="login__tag">
          {invite
            ? "You've been invited — create your account."
            : inviteOnly
              ? "Sign-up is invite-only — ask a friend for an invite link."
              : "Create your duelist account."}
        </p>
        {googleEnabled && (
          <>
            <GoogleButton invite={invite} label="Sign up with Google" />
            <OrDivider />
          </>
        )}
        {error === "invite-only" && (
          <p className="login__error" role="alert">That Google account has no Vault yet, and sign-up is invite-only — open your invite link first, then use Google.</p>
        )}
        <SignupForm invite={invite} />
        <div className="login__demo">
          <span>
            Already have an account? <a className="login__link" href="/login">Sign in</a>
          </span>
        </div>
      </div>
    </main>
  );
}
