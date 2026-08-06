import { redirect } from "next/navigation";
import { getOptionalSession } from "@/lib/auth/dal";

// Deliberately unopinionated about layout beyond the redirect guard — /login
// and /forgot-password want the narrow centered card, /register wants a
// full-bleed split screen, so each page owns its own <main> wrapper instead
// of one shared shape being forced on all three.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getOptionalSession();
  if (session) {
    redirect("/home");
  }

  return <>{children}</>;
}
