import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

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
        <p className="login__tag">Your duelist binder, shared with friends.</p>
        <LoginForm />
        <div className="login__demo">
          <span>
            New here? <a className="login__link" href="/signup">Create an account</a>
          </span>
          <span>
            Demo accounts — password <code>duelist</code>
          </span>
          <span>you@vault.gg · mai@vault.gg · joey@vault.gg</span>
        </div>
      </div>
    </main>
  );
}
