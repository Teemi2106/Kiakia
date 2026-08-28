import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth/dal";
import "./auth.css";

// Two jobs: bounce anyone who already has a session, and scope auth.css to
// the sign-in family. Layout beyond that belongs to <AuthShell>, which every
// page in the group (and both /vendor entry points) renders into — so unlike
// the previous arrangement there is no per-page <main> wrapper to keep in
// sync.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getOptionalSession();
  if (session) {
    redirect("/home");
  }

  return <>{children}</>;
}
