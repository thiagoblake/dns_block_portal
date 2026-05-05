"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

type ApplyRun = {
  id: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  triggered_by?: string | null;
  triggered_by_name: string;
  triggered_by_email: string;
  output: string;
  error_message: string;
  generated_file_path: string;
  backup_file_path: string;
  created_at: string;
};

type ApplyRunsPageResponse = {
  items: ApplyRun[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;

function statusBadgeClass(status: string) {
  switch (status) {
    case "SUCCESS":
      return "bg-emerald-100 text-emerald-900";
    case "FAILED":
      return "bg-rose-100 text-rose-900";
    case "RUNNING":
      return "bg-amber-100 text-amber-900";
    case "REQUESTED":
      return "bg-sky-100 text-sky-900";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

function buildQuery(params: {
  page: number;
  perPage: number;
  q: string;
  status: string;
  from: string;
  to: string;
}) {
  const sp = new URLSearchParams();
  sp.set("page", String(params.page));
  sp.set("per_page", String(params.perPage));
  if (params.q.trim()) sp.set("q", params.q.trim());
  if (params.status) sp.set("status", params.status);
  if (params.from.trim()) sp.set("from", params.from.trim());
  if (params.to.trim()) sp.set("to", params.to.trim());
  return `/api/apply-runs?${sp.toString()}`;
}

export default function ApplyRunsPage() {
  const [data, setData] = useState<ApplyRunsPageResponse | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<(typeof PER_PAGE_OPTIONS)[number]>(20);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setError("");
    const url = buildQuery({ page, perPage, q, status: statusFilter, from, to });
    const raw = await apiRequest<ApplyRunsPageResponse | ApplyRun[]>(url);
    if (Array.isArray(raw)) {
      setData({
        items: raw,
        total: raw.length,
        page: 1,
        per_page: raw.length || 20,
        total_pages: 1
      });
      return;
    }
    setData({
      items: Array.isArray(raw.items) ? raw.items : [],
      total: Number(raw.total) || 0,
      page: Number(raw.page) || 1,
      per_page: Number(raw.per_page) || perPage,
      total_pages: Math.max(1, Number(raw.total_pages) || 1)
    });
  }, [page, perPage, q, statusFilter, from, to]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  const trigger = async () => {
    await apiRequest("/api/unbound/apply", { method: "POST" });
    setMessage("Nova aplicação enfileirada. O worker processará em breve.");
    setPage(1);
    await load();
  };

  const runs = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPagesSafe = Math.max(1, data?.total_pages ?? 1);
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, total);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Aplicações DNS</h1>
          <div className="mt-3 max-w-4xl space-y-2 text-sm leading-relaxed text-slate-600">
            <p>
              Cada <strong>execução</strong> representa um ciclo em que o <strong>worker</strong> lê o banco (listas{" "}
              <code className="rounded bg-slate-200 px-1 text-xs">APPROVED</code> /{" "}
              <code className="rounded bg-slate-200 px-1 text-xs">APPLIED</code>, domínios válidos e não revogados),
              gera o fragmento Unbound (<code className="rounded bg-slate-200 px-1 text-xs">dns-block-portal.conf</code>),
              valida e recarrega o serviço — ou simula isso em modo mock.
            </p>
            <p>
              Execuções são criadas quando alguém <strong>solicita aplicação no DNS</strong> (lista aprovada), após{" "}
              <strong>revogações aprovadas</strong>, expiração de listas, ou quando você usa o botão abaixo para uma{" "}
              <strong>aplicação manual global</strong>. A tabela mostra status, mensagens e quem disparou (quando
              informado).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button className="bg-blue-600 hover:bg-blue-700" type="button" onClick={() => trigger().catch((e) => setError(e.message))}>
            Solicitar aplicação manual
          </Button>
          <Button type="button" variant="outline" onClick={() => load().catch((e) => setError(e.message))}>
            Atualizar lista
          </Button>
        </div>

        {message && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</div>
        )}
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
        )}

        <Card>
          <CardHeader className="border-b border-slate-100 bg-slate-50/80">
            <CardTitle>Filtros</CardTitle>
            <CardDescription>Texto livre no output/erro/ID, status e intervalo de tempo da criação do registro.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="xl:col-span-2">
                <label className="text-xs font-medium text-slate-600">Busca</label>
                <Input
                  className="mt-1"
                  placeholder="Trecho do output, erro ou UUID…"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Status</label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Todos</option>
                  <option value="REQUESTED">REQUESTED</option>
                  <option value="RUNNING">RUNNING</option>
                  <option value="SUCCESS">SUCCESS</option>
                  <option value="FAILED">FAILED</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-600">De</label>
                  <Input
                    type="datetime-local"
                    className="mt-1"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Até</label>
                  <Input
                    type="datetime-local"
                    className="mt-1"
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-700">
                {total === 0 ? (
                  "Nenhuma execução."
                ) : (
                  <>
                    Mostrando <strong className="tabular-nums">{rangeStart}</strong>–
                    <strong className="tabular-nums">{rangeEnd}</strong> de{" "}
                    <strong className="tabular-nums">{total.toLocaleString("pt-BR")}</strong>
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-slate-600">Por página</label>
                <select
                  className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
                  value={perPage}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value) as (typeof PER_PAGE_OPTIONS)[number]);
                    setPage(1);
                  }}
                >
                  {PER_PAGE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <span className="min-w-[5rem] text-center text-sm tabular-nums">{page} / {totalPagesSafe}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPagesSafe}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Criado em</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Disparado por</th>
                <th className="px-4 py-3">Output / resumo</th>
                <th className="px-4 py-3">Erro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((run) => (
                <tr key={run.id} className="align-top hover:bg-slate-50/80">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">
                    {new Date(run.created_at).toLocaleString()}
                    {run.finished_at && (
                      <div className="text-xs text-slate-500">Fim: {new Date(run.finished_at).toLocaleString()}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", statusBadgeClass(run.status))}>
                      {run.status}
                    </span>
                  </td>
                  <td className="max-w-[200px] px-4 py-2.5">
                    {run.triggered_by_name || run.triggered_by_email ? (
                      <>
                        <span className="font-medium text-slate-800">{run.triggered_by_name || "—"}</span>
                        {run.triggered_by_email && <div className="truncate text-xs text-slate-500">{run.triggered_by_email}</div>}
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">Sistema / worker</span>
                    )}
                  </td>
                  <td className="max-w-md px-4 py-2.5">
                    <p className="line-clamp-3 text-xs text-slate-700" title={run.output}>
                      {run.output || "—"}
                    </p>
                    {run.generated_file_path && (
                      <p className="mt-1 truncate font-mono text-[10px] text-slate-500" title={run.generated_file_path}>
                        {run.generated_file_path}
                      </p>
                    )}
                  </td>
                  <td className="max-w-xs px-4 py-2.5">
                    {run.error_message ? (
                      <span className="text-xs text-rose-700" title={run.error_message}>
                        {run.error_message}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                    Nenhuma execução com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
