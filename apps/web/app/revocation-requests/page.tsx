"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

type RevocationRequest = {
  id: string;
  kind: "LIST" | "DOMAIN";
  block_list_id: string;
  block_list_title: string;
  blocked_domain_id?: string | null;
  blocked_domain_label: string;
  status: string;
  reason: string;
  reject_reason?: string;
  requested_by: string;
  requested_by_name: string;
  requested_by_email: string;
  approved_by?: string | null;
  approved_by_name?: string;
  approved_by_email?: string;
  created_at: string;
  approved_at?: string | null;
};

type RevocationPageResponse = {
  items: RevocationRequest[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;

function statusBadge(status: string) {
  switch (status) {
    case "PENDING_APPROVAL":
      return "bg-amber-100 text-amber-900 ring-1 ring-amber-200/80";
    case "APPROVED":
      return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200/80";
    case "REJECTED":
      return "bg-rose-100 text-rose-900 ring-1 ring-rose-200/80";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "PENDING_APPROVAL":
      return "Pendente";
    case "APPROVED":
      return "Aprovada";
    case "REJECTED":
      return "Rejeitada";
    default:
      return status;
  }
}

function buildQuery(params: {
  page: number;
  perPage: number;
  status: string;
  kind: string;
  q: string;
  from: string;
  to: string;
}) {
  const sp = new URLSearchParams();
  sp.set("page", String(params.page));
  sp.set("per_page", String(params.perPage));
  if (params.status) sp.set("status", params.status);
  if (params.kind) sp.set("kind", params.kind);
  if (params.q.trim()) sp.set("q", params.q.trim());
  if (params.from.trim()) sp.set("from", params.from.trim());
  if (params.to.trim()) sp.set("to", params.to.trim());
  return `/api/revocation-requests?${sp.toString()}`;
}

export default function RevocationRequestsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<RevocationPageResponse | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<(typeof PER_PAGE_OPTIONS)[number]>(20);
  const [statusFilter, setStatusFilter] = useState("PENDING_APPROVAL");
  const [kindFilter, setKindFilter] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const url = buildQuery({ page, perPage, status: statusFilter, kind: kindFilter, q, from, to });
    const [me, raw] = await Promise.all([apiRequest<User>("/api/auth/me"), apiRequest<RevocationPageResponse | RevocationRequest[]>(url)]);
    setUser(me);
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
  }, [page, perPage, statusFilter, kindFilter, q, from, to]);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 400);
    return () => clearTimeout(t);
  }, [qInput]);

  const prevQRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevQRef.current === null) {
      prevQRef.current = q;
      return;
    }
    if (prevQRef.current !== q) {
      prevQRef.current = q;
      setPage(1);
    }
  }, [q]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const approve = async (id: string) => {
    await apiRequest(`/api/revocation-requests/${id}/approve`, { method: "POST", body: "{}" });
    setMessage("Solicitação aprovada. Uma aplicação DNS foi enfileirada para atualizar o Unbound.");
    await load();
  };

  const reject = async () => {
    if (!rejectId) return;
    if (rejectReason.trim().length < 3) {
      setError("Informe o motivo da rejeição (mínimo 3 caracteres).");
      return;
    }
    setError("");
    await apiRequest(`/api/revocation-requests/${rejectId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reject_reason: rejectReason })
    });
    setRejectId(null);
    setRejectReason("");
    setMessage("Solicitação rejeitada.");
    await load();
  };

  const isAdmin = user?.role === "ADMIN";
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPagesSafe = Math.max(1, data?.total_pages ?? 1);
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, total);

  const pendingHighlight = statusFilter === "PENDING_APPROVAL";

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <h1 className="text-2xl font-semibold text-slate-900">Revogações</h1>
            <p className="text-sm leading-relaxed text-slate-600">
              Pedidos para <strong>tirar do DNS</strong> uma lista inteira ou um domínio avulso, sempre após a lista estar{" "}
              <strong>aplicada</strong>. Quando um admin <strong>aprova</strong>, o portal enfileira uma{" "}
              <Link href="/apply-runs" className="font-medium text-blue-600 hover:text-blue-800">
                aplicação DNS
              </Link>{" "}
              e o worker <strong>regenera</strong> o arquivo de bloqueios com o estado atual do banco (o escopo aprovado deixa
              de constar). <strong>Rejeitar</strong> exige motivo registrado em auditoria.
            </p>
            <p className="text-xs text-slate-500">
              Operadores abrem solicitações no detalhe da lista; aqui você acompanha a fila e, se for admin, decide.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href="/block-lists"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-100"
            >
              Ir às listas de bloqueio
            </Link>
            <Link
              href="/apply-runs"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-100"
            >
              Ver aplicações DNS
            </Link>
          </div>
        </div>

        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div>
        )}
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
        )}

        {!isAdmin && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <strong>Operador / auditor:</strong> você vê todas as solicitações, mas só <strong>administradores</strong> podem
            aprovar ou rejeitar. Use os filtros para acompanhar o andamento.
          </div>
        )}

        {isAdmin && pendingHighlight && total > 0 && (
          <div className="rounded-lg border border-amber-300/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
            <strong>{total.toLocaleString("pt-BR")} pendente(s)</strong> no total com os filtros atuais (esta página mostra até{" "}
            {perPage}). Revise motivo e lista/domínio antes de aprovar.
          </div>
        )}

        <Card>
          <CardHeader className="border-b border-slate-100 bg-slate-50/80">
            <CardTitle>Filtros e busca</CardTitle>
            <CardDescription>
              Por status, tipo (lista ou domínio), texto livre (motivo, título da lista, processo, domínio, UUID) e período.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                  <option value="PENDING_APPROVAL">Pendentes</option>
                  <option value="APPROVED">Aprovadas</option>
                  <option value="REJECTED">Rejeitadas</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Tipo</label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={kindFilter}
                  onChange={(e) => {
                    setKindFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Lista e domínio</option>
                  <option value="LIST">Só lista inteira</option>
                  <option value="DOMAIN">Só domínio</option>
                </select>
              </div>
              <div className="md:col-span-2 xl:col-span-2">
                <label className="text-xs font-medium text-slate-600">Busca</label>
                <Input
                  className="mt-1"
                  placeholder="Motivo, título da lista, processo, domínio, trecho do ID…"
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
              <div>
                <label className="text-xs font-medium text-slate-600">Solicitado desde</label>
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

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-700">
                {total === 0 ? (
                  "Nenhuma solicitação neste filtro."
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
                <span className="min-w-[5rem] text-center text-sm tabular-nums text-slate-700">
                  {page} / {totalPagesSafe}
                </span>
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

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Lista</th>
                <th className="px-4 py-3">Domínio</th>
                <th className="px-4 py-3">Solicitante</th>
                <th className="px-4 py-3">Quando</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 min-w-[200px]">Motivo</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((r) => (
                <tr key={r.id} className="align-top hover:bg-slate-50/80">
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        r.kind === "LIST" ? "bg-violet-100 text-violet-900" : "bg-cyan-100 text-cyan-900"
                      )}
                    >
                      {r.kind === "LIST" ? "Lista" : "Domínio"}
                    </span>
                  </td>
                  <td className="max-w-[220px] px-4 py-3">
                    <Link
                      href={`/block-lists/${r.block_list_id}`}
                      className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {r.block_list_title?.trim() || "Lista"}
                    </Link>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-400">{r.block_list_id}</div>
                  </td>
                  <td className="max-w-[200px] px-4 py-3 font-mono text-xs text-slate-800">
                    {r.kind === "DOMAIN" ? (
                      <span title={r.blocked_domain_label}>{r.blocked_domain_label?.trim() || r.blocked_domain_id || "—"}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="max-w-[180px] px-4 py-3">
                    <span className="font-medium text-slate-800">{r.requested_by_name || "—"}</span>
                    {r.requested_by_email && <div className="truncate text-xs text-slate-500">{r.requested_by_email}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-700">
                    <div>{new Date(r.created_at).toLocaleString()}</div>
                    {r.approved_at && (
                      <div className="text-slate-500" title="Decisão">
                        Dec.: {new Date(r.approved_at).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", statusBadge(r.status))}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    <p className="line-clamp-3 text-xs text-slate-700" title={r.reason}>
                      {r.reason}
                    </p>
                    {r.reject_reason && (
                      <p className="mt-1 line-clamp-2 text-xs text-rose-700" title={r.reject_reason}>
                        Rejeição: {r.reject_reason}
                      </p>
                    )}
                    {(r.approved_by_name || r.approved_by_email) && r.status !== "PENDING_APPROVAL" && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Por: {r.approved_by_name}
                        {r.approved_by_email ? ` · ${r.approved_by_email}` : ""}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin && r.status === "PENDING_APPROVAL" ? (
                      <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:justify-end">
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => approve(r.id)}>
                          Aprovar
                        </Button>
                        <Button size="sm" variant="outline" className="border-rose-300 text-rose-800" onClick={() => setRejectId(r.id)}>
                          Rejeitar
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center text-slate-500">
                    Nenhuma solicitação encontrada. Ajuste os filtros ou abra um pedido no detalhe de uma lista aplicada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {rejectId && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setRejectId(null);
                setRejectReason("");
              }
            }}
          >
            <div className="max-w-md" onMouseDown={(e) => e.stopPropagation()}>
              <Card className="shadow-xl">
              <CardHeader>
                <CardTitle>Rejeitar solicitação</CardTitle>
                <CardDescription>Motivo obrigatório (mín. 3 caracteres), visível na auditoria.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <textarea
                  className="min-h-[96px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Explique o motivo da rejeição…"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setRejectId(null);
                      setRejectReason("");
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button className="bg-rose-600 hover:bg-rose-700" onClick={reject}>
                    Confirmar rejeição
                  </Button>
                </div>
              </CardContent>
            </Card>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
