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
          <img src="/brand/binder.png" alt="" width="44" height="44" />
          <span>VIRTUAL BINDER</span>
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
          <p className="login__error" role="alert">That Google account has no binder yet, and sign-up is invite-only — open your invite link first, then use Google.</p>
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
