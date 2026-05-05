"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api";

type AuditLog = {
  id: string;
  user_id?: string | null;
  user_name: string;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  created_at: string;
  ip_address: string;
};

type AuditPageResponse = {
  items: AuditLog[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;

const ENTITY_HINTS = [
  "auth",
  "users",
  "block_lists",
  "blocked_domains",
  "revocation_requests",
  "uploaded_files",
  "apply_runs"
];

function buildQuery(params: Record<string, string | number>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === "" || v === undefined || v === null) return;
    sp.set(k, String(v));
  });
  const qs = sp.toString();
  return qs ? `/api/audit-logs?${qs}` : "/api/audit-logs";
}

export default function AuditLogsPage() {
  const [data, setData] = useState<AuditPageResponse | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<(typeof PER_PAGE_OPTIONS)[number]>(20);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [userQ, setUserQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setError("");
    const url = buildQuery({
      page,
      per_page: perPage,
      q: q.trim(),
      action: action.trim(),
      entity_type: entityType.trim(),
      user_q: userQ.trim(),
      from: from.trim(),
      to: to.trim()
    });
    const raw = await apiRequest<AuditPageResponse | AuditLog[]>(url);
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
  }, [page, perPage, q, action, entityType, userQ, from, to]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  const logs = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPagesSafe = Math.max(1, data?.total_pages ?? 1);
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, total);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Auditoria</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Registro de ações relevantes no portal (login, listas, domínios, revogações, uploads, etc.). Use filtros e
            período para localizar eventos. Os dados vêm do banco em ordem cronológica inversa.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
        )}

        <Card>
          <CardHeader className="border-b border-slate-100 bg-slate-50/80">
            <CardTitle>Filtros</CardTitle>
            <CardDescription>Busca textual, tipo de entidade, ação, usuário e intervalo de datas (início/fim).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="xl:col-span-2">
                <label className="text-xs font-medium text-slate-600">Busca geral</label>
                <Input
                  className="mt-1"
                  placeholder="Ação, entidade, IP ou ID…"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Ação (contém)</label>
                <Input
                  className="mt-1"
                  placeholder="Ex.: BLOCK_LIST"
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Tipo de entidade (exato)</label>
                <Input
                  className="mt-1 font-mono text-sm"
                  placeholder="block_lists"
                  list="audit-entity-hints"
                  value={entityType}
                  onChange={(e) => {
                    setEntityType(e.target.value);
                    setPage(1);
                  }}
                />
                <datalist id="audit-entity-hints">
                  {ENTITY_HINTS.map((h) => (
                    <option key={h} value={h} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="xl:col-span-2">
                <label className="text-xs font-medium text-slate-600">Usuário (nome ou e-mail)</label>
                <Input
                  className="mt-1"
                  placeholder="Fragmento do nome ou e-mail de quem executou"
                  value={userQ}
                  onChange={(e) => {
                    setUserQ(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">De (data/hora)</label>
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
                <label className="text-xs font-medium text-slate-600">Até (data/hora)</label>
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-700">
                {total === 0 ? (
                  "Nenhum registro."
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
                <Button type="button" variant="secondary" size="sm" onClick={() => load().catch((e) => setError(e.message))}>
                  Atualizar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Ação</th>
                <th className="px-4 py-3">Entidade</th>
                <th className="px-4 py-3">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/80">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{new Date(log.created_at).toLocaleString()}</td>
                  <td className="max-w-[200px] px-4 py-2.5">
                    {log.user_name || log.user_email ? (
                      <>
                        <span className="font-medium text-slate-800">{log.user_name || "—"}</span>
                        {log.user_email && <div className="truncate text-xs text-slate-500">{log.user_email}</div>}
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="max-w-[220px] px-4 py-2.5 font-mono text-xs text-slate-800">{log.action}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-slate-800">{log.entity_type}</span>
                    {log.entity_id && <div className="truncate font-mono text-[11px] text-slate-500">{log.entity_id}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-600">{log.ip_address || "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                    Nenhum evento com os filtros atuais.
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
