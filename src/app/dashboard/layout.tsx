import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex-1 flex flex-col">
      <nav className="border-b border-[var(--color-border)] sticky top-0 z-10 bg-[var(--color-bg)]/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[var(--color-ink)] text-white">
              <svg viewBox="0 0 20 20" width="12" height="12" fill="none">
                <circle cx="10" cy="6" r="2.5" fill="currentColor" />
                <path d="M10 10c-2.8 0-5 2.2-5 5h10c0-2.8-2.2-5-5-5Z" fill="currentColor" />
              </svg>
            </span>
            <span className="font-medium tracking-tight">eventChart</span>
          </Link>
          <div className="flex items-center gap-3 text-[13px]">
            <span className="text-[var(--color-fg-muted)] hidden sm:inline">
              {session.user.email}
            </span>
            <form action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}>
              <button type="submit" className="btn btn-ghost h-9 px-3 text-[13px]">Sign out</button>
            </form>
          </div>
        </div>
      </nav>
      <div className="flex-1">{children}</div>
    </div>
  );
}
