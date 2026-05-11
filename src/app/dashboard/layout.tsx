import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex-1 flex flex-col">
      <nav className="border-b border-[var(--color-border)] sticky top-0 z-10 bg-[var(--color-bg)]/85 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <Link href="/dashboard" className="font-bold tracking-tight flex items-center gap-2">
            <span className="inline-block w-6 h-6 rounded-md bg-[var(--color-brand)]" />
            eventChart
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[var(--color-fg-muted)] hidden sm:inline">
              {session.user.email}
            </span>
            <form action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}>
              <button type="submit" className="btn btn-ghost h-9 px-3 text-sm">Sign out</button>
            </form>
          </div>
        </div>
      </nav>
      <div className="flex-1">{children}</div>
    </div>
  );
}
