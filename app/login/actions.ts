"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export async function loginAction(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") || "").toLowerCase(),
      password: String(formData.get("password") || ""),
      redirectTo: "/",
    });
  } catch (e) {
    if (e instanceof AuthError) return "Invalid email or password.";
    throw e; // re-throw the redirect that signIn raises on success
  }
  return undefined;
}
