"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

type DashboardData = {
  total_lists: number;
  pending_approval: number;
  approved_lists: number;
  applied_lists: number;
  revoked_lists: number;
  expired_lists: number;
  total_domains: number;
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([apiRequest<DashboardData>("/api/dashboard"), apiRequest<User>("/api/auth/me")])
      .then(([dashboard, me]) => {
        setData(dashboard);
        setUser(me);
      })
      .catch((err) => setError(err.message));
  }, []);

  const isAdmin = user?.role === "ADMIN";

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Painel</h1>
          <p className="mt-1 text-sm text-slate-600">
            Visão geral do estado das listas e domínios ativos no DNS (domínios revogados não entram na contagem).
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!data && !error && <p className="text-sm text-slate-600">Carregando…</p>}

        {data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric title="Total de listas" value={data.total_lists} />
              <Metric
                title="Pendentes de aprovação"
                value={data.pending_approval}
                accent="amber"
                href="/block-lists?status=PENDING_APPROVAL"
              />
              <Metric title="Aprovadas (aguardando DNS)" value={data.approved_lists} accent="blue" />
              <Metric title="Aplicadas no DNS" value={data.applied_lists} accent="emerald" />
              <Metric title="Revogadas" value={data.revoked_lists} />
              <Metric title="Expiradas" value={data.expired_lists} />
              <Metric title="Domínios ativos bloqueados" value={data.total_domains} accent="slate" />
            </div>

            {isAdmin && data.pending_approval > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                Há <strong>{data.pending_approval.toLocaleString("pt-BR")}</strong> lista(s) aguardando aprovação.{" "}
                <Link href="/block-lists?status=PENDING_APPROVAL" className="font-semibold text-amber-900 underline">
                  Ver pendentes
                </Link>
                {" — "}
                administradores podem excluir rascunhos e pendentes antes da aprovação.
              </div>
            )}

            <Card>
              <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">Próximos passos</p>
                  <p className="text-sm text-slate-600">
                    Revogações unitárias ou de lista passam pela fila em <strong>Revogações</strong>.
                  </p>
                </div>
                <Link
                  href="/block-lists"
                  className="inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Gerenciar listas
                </Link>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Metric({
  title,
  value,
  accent,
  href
}: {
  title: string;
  value: number;
  accent?: "amber" | "blue" | "emerald" | "slate";
  href?: string;
}) {
  const ring =
    accent === "amber"
      ? "border-amber-200 bg-amber-50"
      : accent === "blue"
        ? "border-blue-200 bg-blue-50"
        : accent === "emerald"
          ? "border-emerald-200 bg-emerald-50"
          : accent === "slate"
            ? "border-slate-200 bg-slate-50"
            : "border-slate-200 bg-white";

  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
      {href && value > 0 && (
        <p className="mt-2 text-xs font-medium text-blue-700">Ver detalhes →</p>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn("block rounded-xl border transition hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500", ring)}
      >
        <div className="py-5 px-6">{inner}</div>
      </Link>
    );
  }

  return (
    <Card className={ring}>
      <CardContent className="py-5">{inner}</CardContent>
    </Card>
  );
}
