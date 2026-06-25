"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest, getApiBaseUrl, getToken, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

type BatchStats = {
  total: number;
  matched: number;
  not_found: number;
  already_revoked: number;
  pending_revocation: number;
  invalid: number;
};

type RevocationBatch = {
  id: string;
  title: string;
  source_type: string;
  process_number?: string;
  description?: string;
  reason: string;
  status: string;
  reject_reason?: string;
  created_at: string;
  submitted_at?: string | null;
  applied_at?: string | null;
};

type BatchItem = {
  id: string;
  original_value: string;
  normalized_domain: string;
  match_status: string;
  validation_error?: string;
  block_list_title?: string;
  block_list_id?: string | null;
};

function matchLabel(status: string) {
  switch (status) {
    case "MATCHED":
      return "Elegível";
    case "NOT_FOUND":
      return "Não encontrado";
    case "ALREADY_REVOKED":
      return "Já revogado";
    case "PENDING_REVOCATION":
      return "Revogação pendente";
    case "INVALID":
      return "Inválido";
    default:
      return status;
  }
}

function matchStyle(status: string) {
  switch (status) {
    case "MATCHED":
      return "bg-emerald-100 text-emerald-900";
    case "NOT_FOUND":
      return "bg-slate-100 text-slate-700";
    case "ALREADY_REVOKED":
      return "bg-blue-100 text-blue-900";
    case "PENDING_REVOCATION":
      return "bg-amber-100 text-amber-900";
    case "INVALID":
      return "bg-rose-100 text-rose-900";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

export default function RevocationBatchDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [user, setUser] = useState<User | null>(null);
  const [batch, setBatch] = useState<RevocationBatch | null>(null);
  const [stats, setStats] = useState<BatchStats | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [itemTotal, setItemTotal] = useState(0);
  const [itemPage, setItemPage] = useState(1);
  const [matchFilter, setMatchFilter] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [message, setMessage] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const isAdmin = user?.role === "ADMIN";
  const isDraft = batch?.status === "DRAFT";
  const isPending = batch?.status === "PENDING_APPROVAL";

  const loadMeta = useCallback(async () => {
    const res = await apiRequest<{ batch: RevocationBatch; stats: BatchStats }>(`/api/revocation-batches/${id}`);
    setBatch(res.batch);
    setStats(res.stats);
  }, [id]);

  const loadItems = useCallback(async () => {
    const sp = new URLSearchParams({ page: String(itemPage), per_page: "50" });
    if (matchFilter) sp.set("match_status", matchFilter);
    const res = await apiRequest<{ items: BatchItem[]; total: number }>(`/api/revocation-batches/${id}/items?${sp}`);
    setItems(res.items);
    setItemTotal(res.total);
  }, [id, itemPage, matchFilter]);

  useEffect(() => {
    apiRequest<User>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    loadMeta().catch((err) => setMessage(err.message));
  }, [loadMeta]);

  useEffect(() => {
    loadItems().catch((err) => setMessage(err.message));
  }, [loadItems]);

  const refreshAll = async () => {
    await loadMeta();
    await loadItems();
  };

  const uploadFile = async (file: File, mode: "append" | "replace") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    const res = await fetch(`${getApiBaseUrl()}/api/revocation-batches/${id}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
      body: fd
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Falha no upload");
    }
    await refreshAll();
    setMessage(`Upload concluído (${mode}).`);
  };

  const addBulk = async () => {
    const values = bulkText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    await apiRequest(`/api/revocation-batches/${id}/domains/bulk`, {
      method: "POST",
      body: JSON.stringify({ values, mode: "append" })
    });
    setBulkText("");
    setMessage("Domínios adicionados e cruzados com as listas.");
    await refreshAll();
  };

  const submitBatch = async () => {
    await apiRequest(`/api/revocation-batches/${id}/submit`, { method: "POST", body: "{}" });
    setMessage("Lote enviado para aprovação.");
    await refreshAll();
  };

  const approveBatch = async () => {
    const res = await apiRequest<{ revoked_count: number }>(`/api/revocation-batches/${id}/approve`, {
      method: "POST",
      body: "{}"
    });
    setMessage(`Lote aprovado. ${res.revoked_count} domínio(s) revogado(s) nas listas originais.`);
    await refreshAll();
  };

  const rejectBatch = async () => {
    if (rejectReason.trim().length < 3) {
      setMessage("Informe o motivo da rejeição (mín. 3 caracteres).");
      return;
    }
    await apiRequest(`/api/revocation-batches/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reject_reason: rejectReason })
    });
    setRejectReason("");
    setMessage("Lote rejeitado.");
    await refreshAll();
  };

  const rematch = async () => {
    await apiRequest(`/api/revocation-batches/${id}/rematch`, { method: "POST", body: "{}" });
    setMessage("Cruzamento atualizado com o estado atual das listas.");
    await refreshAll();
  };

  if (!batch) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Carregando lote…</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <Link href="/revocation-batches" className="text-sm font-medium text-blue-600 hover:text-blue-800">
          ← Voltar aos lotes
        </Link>

        <header className="border-b border-slate-200 pb-4">
          <h1 className="text-2xl font-bold text-slate-900">{batch.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{batch.description || batch.reason}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">{batch.status}</span>
            <span className="rounded-full bg-indigo-50 px-2 py-0.5">{batch.source_type}</span>
            {batch.process_number && <span className="font-mono text-slate-600">Proc. {batch.process_number}</span>}
          </div>
        </header>

        {message && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</div>
        )}

        {stats && (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Total" value={stats.total} />
            <Stat label="Elegíveis" value={stats.matched} accent="emerald" />
            <Stat label="Não encontrados" value={stats.not_found} />
            <Stat label="Já revogados" value={stats.already_revoked} />
            <Stat label="Pend. revogação" value={stats.pending_revocation} accent="amber" />
            <Stat label="Inválidos" value={stats.invalid} accent="rose" />
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[1fr_18rem]">
          <div className="space-y-4">
            {isDraft && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Adicionar domínios</CardTitle>
                  <CardDescription>TXT/CSV ou um domínio por linha. O sistema busca em listas APPLIED.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    type="file"
                    accept=".txt,.csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadFile(f, "append").catch((err) => setMessage(err.message));
                      e.target.value = "";
                    }}
                  />
                  <textarea
                    className="min-h-[100px] w-full rounded-md border px-3 py-2 font-mono text-sm"
                    placeholder="dominio1.com&#10;dominio2.org"
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => addBulk().catch((err) => setMessage(err.message))}>
                      Adicionar texto
                    </Button>
                    <Button variant="outline" onClick={() => rematch().catch((err) => setMessage(err.message))}>
                      Re-cruzar listas
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Domínios do lote</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <select
                  className="h-9 rounded-md border px-2 text-sm"
                  value={matchFilter}
                  onChange={(e) => {
                    setMatchFilter(e.target.value);
                    setItemPage(1);
                  }}
                >
                  <option value="">Todos os status</option>
                  <option value="MATCHED">Elegíveis</option>
                  <option value="NOT_FOUND">Não encontrados</option>
                  <option value="ALREADY_REVOKED">Já revogados</option>
                  <option value="PENDING_REVOCATION">Revogação pendente</option>
                  <option value="INVALID">Inválidos</option>
                </select>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Domínio</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Lista origem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            <p className="font-mono text-xs">{it.normalized_domain || it.original_value}</p>
                            {it.validation_error && <p className="text-xs text-rose-600">{it.validation_error}</p>}
                          </td>
                          <td className="px-3 py-2">
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", matchStyle(it.match_status))}>
                              {matchLabel(it.match_status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {it.block_list_title ? (
                              <Link href={`/block-lists/${it.block_list_id}`} className="text-blue-600 hover:underline">
                                {it.block_list_title}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                            Nenhum domínio neste filtro.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-500">{itemTotal.toLocaleString("pt-BR")} registro(s) no total</p>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Fluxo</CardTitle>
                <CardDescription className="text-xs">Rascunho → envio → aprovação → revogação no DNS</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {isDraft && (
                  <Button variant="outline" size="sm" onClick={() => submitBatch().catch((err) => setMessage(err.message))}>
                    Enviar para aprovação
                  </Button>
                )}
                {isAdmin && isPending && (
                  <>
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={() => approveBatch().catch((err) => setMessage(err.message))}
                    >
                      Aprovar e revogar domínios
                    </Button>
                    <textarea
                      className="min-h-[64px] w-full rounded-md border px-2 py-1 text-sm"
                      placeholder="Motivo da rejeição…"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-rose-200 text-rose-800"
                      onClick={() => rejectBatch().catch((err) => setMessage(err.message))}
                    >
                      Rejeitar lote
                    </Button>
                  </>
                )}
                {batch.status === "APPLIED" && (
                  <p className="text-xs text-emerald-800">Revogação aplicada. Domínios marcados nas listas originais.</p>
                )}
                {batch.status === "REJECTED" && batch.reject_reason && (
                  <p className="text-xs text-rose-800">Rejeitado: {batch.reject_reason}</p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "emerald" | "amber" | "rose" }) {
  const ring =
    accent === "emerald"
      ? "border-emerald-200 bg-emerald-50"
      : accent === "amber"
        ? "border-amber-200 bg-amber-50"
        : accent === "rose"
          ? "border-rose-200 bg-rose-50"
          : "border-slate-200 bg-white";
  return (
    <div className={cn("rounded-lg border px-3 py-2", ring)}>
      <p className="text-[10px] font-semibold uppercase text-slate-500">{label}</p>
      <p className="text-xl font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
