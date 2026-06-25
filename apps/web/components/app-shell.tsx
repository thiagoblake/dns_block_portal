"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { apiRequest, clearToken, type User } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Role = User["role"];

type NavItem = {
  href: string;
  label: string;
  /** Se definido, só estes perfis veem o link (alinha às rotas da API). */
  roles?: readonly Role[];
};

const nav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["ADMIN", "OPERADOR", "AUDITOR"] },
  { href: "/block-lists", label: "Listas de bloqueio", roles: ["ADMIN", "OPERADOR", "AUDITOR"] },
  { href: "/revocation-batches", label: "Revogação em lote", roles: ["ADMIN", "OPERADOR", "AUDITOR"] },
  { href: "/revocation-requests", label: "Revogações", roles: ["ADMIN", "OPERADOR", "AUDITOR"] },
  { href: "/users", label: "Usuários", roles: ["ADMIN"] },
  { href: "/audit-logs", label: "Auditoria", roles: ["ADMIN", "AUDITOR"] },
  { href: "/apply-runs", label: "Aplicações DNS", roles: ["ADMIN", "AUDITOR"] }
];

export function AppShell({
  children,
  fullWidth = true
}: {
  children: React.ReactNode;
  /** Largura útil total (padrão). Use false apenas para telas excepcionalmente estreitas. */
  fullWidth?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    apiRequest<User>("/api/auth/me")
      .then(setUser)
      .catch(() => {
        clearToken();
        router.push("/login");
      });
  }, [router]);

  const links = useMemo(() => {
    if (!user) return [];
    return nav.filter((item) => item.roles?.includes(user.role) ?? false);
  }, [user]);

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30 h-screen w-[260px] flex-col border-r border-slate-800 bg-slate-950 text-slate-100">
        <div className="shrink-0 border-b border-slate-800 px-5 py-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">DNS Block Portal</p>
          <p className="mt-1 truncate text-sm text-white">{user?.name ?? "…"}</p>
          <p className="truncate text-xs text-slate-400">{user?.email ?? ""}</p>
          <span className="mt-3 inline-flex rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-200">
            {user?.role ?? "…"}
          </span>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {links.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm transition ${
                  active ? "bg-blue-600 text-white shadow-sm" : "text-slate-300 hover:bg-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-slate-800 p-4">
          <Button
            className="w-full border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
            variant="outline"
            onClick={() => {
              clearToken();
              router.push("/login");
            }}
          >
            Sair
          </Button>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-[260px]">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">DNS Block Portal</span>
            <span className="text-xs text-slate-500">{user?.role}</span>
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {links.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${
                  pathname === item.href ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </header>
        <main
          className={cn(
            "min-w-0",
            fullWidth
              ? "w-full max-w-[100vw] px-3 py-6 sm:px-4 lg:px-6"
              : "mx-auto max-w-6xl px-4 py-8"
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
