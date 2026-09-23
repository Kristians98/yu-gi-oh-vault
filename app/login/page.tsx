import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/auth";
import { LoginForm } from "@/components/login-form";
import { GoogleButton, OrDivider } from "@/components/google-button";

const ERRORS: Record<string, string> = {
  google: "Google didn't return a verified email — try another account.",
  OAuthCallbackError: "Google sign-in was cancelled or failed. Try again.",
  AccessDenied: "That Google account isn't allowed in.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const session = await auth();
  if (session?.user) redirect("/");
  const errorMsg = error ? ERRORS[error] ?? "Sign-in failed. Try again." : null;

  return (
    <main className="login">
      <div className="login__card">
        <div className="login__brand">
          <img src="/brand/binder.png" alt="" width="44" height="44" />
          <span>VIRTUAL BINDER</span>
        </div>
        <p className="login__tag">Your duelist binder, shared with friends.</p>
        {googleEnabled && (
          <>
            <GoogleButton />
            <OrDivider />
          </>
        )}
        {errorMsg && <p className="login__error" role="alert">{errorMsg}</p>}
        <LoginForm />
        <div className="login__demo">
          <span>
            New here? <a className="login__link" href="/signup">Create an account</a>
          </span>
        </div>
      </div>
    </main>
  );
}
