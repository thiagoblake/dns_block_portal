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

type BlockList = {
  id: string;
  title: string;
  source_type: string;
  process_number?: string;
  description?: string;
  dns_action: string;
  redirect_ip?: string;
  status: string;
  expires_at?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  applied_at?: string | null;
  revoked_at?: string | null;
  revoke_reason?: string;
  created_at: string;
};

type BlockedDomain = {
  id: string;
  block_list_id: string;
  original_value: string;
  normalized_domain: string;
  is_valid: boolean;
  validation_error?: string;
  preexisting_note?: string;
  revoked_at?: string | null;
  created_at: string;
};

type DomainsPageResponse = {
  items: BlockedDomain[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

type RevocationRequest = {
  id: string;
  kind: "LIST" | "DOMAIN";
  block_list_title?: string;
  blocked_domain_label?: string;
  status: string;
  reason: string;
  reject_reason?: string;
  blocked_domain_id?: string | null;
  requested_by_name?: string;
  requested_by_email?: string;
  created_at: string;
};

const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;

function statusStyle(status: string) {
  switch (status) {
    case "APPLIED":
      return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200/60";
    case "APPROVED":
      return "bg-blue-100 text-blue-900 ring-1 ring-blue-200/60";
    case "PENDING_APPROVAL":
      return "bg-amber-100 text-amber-900 ring-1 ring-amber-200/60";
    case "DRAFT":
      return "bg-slate-100 text-slate-800 ring-1 ring-slate-200/80";
    case "REVOKED":
    case "EXPIRED":
      return "bg-rose-100 text-rose-900 ring-1 ring-rose-200/60";
    case "FAILED":
      return "bg-orange-100 text-orange-900 ring-1 ring-orange-200/60";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

function TramitationTimeline({ list }: { list: BlockList }) {
  const steps: { label: string; at: string | null | undefined }[] = [
    { label: "Lista criada", at: list.created_at },
    { label: "Enviada para aprovação", at: list.submitted_at },
    { label: "Aprovada", at: list.approved_at },
    { label: "Aplicada no DNS", at: list.applied_at }
  ];

  return (
    <div className="space-y-0">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Tramitação</p>
      <ul className="relative space-y-0 border-l border-slate-200 pl-4">
        {steps.map((s) => {
          const done = Boolean(s.at);
          return (
            <li key={s.label} className="relative pb-4 last:pb-0">
              <span
                className={cn(
                  "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white ring-1",
                  done ? "bg-emerald-500 ring-emerald-600/30" : "bg-slate-200 ring-slate-300"
                )}
              />
              <p className="text-sm font-medium text-slate-800">{s.label}</p>
              <p className="text-xs text-slate-500">{done ? new Date(s.at!).toLocaleString() : "Ainda não"}</p>
            </li>
          );
        })}
      </ul>
      {list.revoked_at && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          <p className="font-semibold">Lista revogada</p>
          <p>{new Date(list.revoked_at).toLocaleString()}</p>
          {list.revoke_reason && <p className="mt-1 text-rose-800">{list.revoke_reason}</p>}
        </div>
      )}
    </div>
  );
}

export default function BlockListDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [user, setUser] = useState<User | null>(null);
  const [list, setList] = useState<BlockList | null>(null);
  const [revReqs, setRevReqs] = useState<RevocationRequest[]>([]);

  const [domains, setDomains] = useState<BlockedDomain[]>([]);
  const [domainTotal, setDomainTotal] = useState(0);
  const [domainPage, setDomainPage] = useState(1);
  const [domainPerPage, setDomainPerPage] = useState<(typeof PER_PAGE_OPTIONS)[number]>(10);
  const [domainTotalPages, setDomainTotalPages] = useState(1);
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [domainTableQ, setDomainTableQ] = useState("");
  const [debouncedDomainTableQ, setDebouncedDomainTableQ] = useState("");

  const [message, setMessage] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [bulkText, setBulkText] = useState("site.com\nhttps://exemplo.org/caminho");
  const [bulkPreview, setBulkPreview] = useState<Record<string, unknown> | null>(null);
  const [listRevokeReason, setListRevokeReason] = useState("");
  const [domainRevoke, setDomainRevoke] = useState<{ id: string; reason: string } | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadChoice, setUploadChoice] = useState<{ file: File } | null>(null);

  const loadMeta = useCallback(async () => {
    const [me, l, r] = await Promise.all([
      apiRequest<User>("/api/auth/me"),
      apiRequest<BlockList>(`/api/block-lists/${id}`),
      apiRequest<RevocationRequest[] | { items: RevocationRequest[] }>(
        `/api/revocation-requests?block_list_id=${id}&page=1&per_page=100`
      )
    ]);
    setUser(me);
    setList(l);
    setRevReqs(Array.isArray(r) ? r : r.items ?? []);
  }, [id]);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = domainTableQ.trim();
      setDebouncedDomainTableQ((prev) => {
        if (prev !== next) {
          setDomainPage(1);
        }
        return next;
      });
    }, 400);
    return () => clearTimeout(t);
  }, [domainTableQ]);

  const loadDomains = useCallback(async () => {
    setDomainsLoading(true);
    try {
      const qParam = debouncedDomainTableQ.trim()
        ? `&q=${encodeURIComponent(debouncedDomainTableQ.trim())}`
        : "";
      const data = await apiRequest<DomainsPageResponse | BlockedDomain[]>(
        `/api/block-lists/${id}/domains?page=${domainPage}&per_page=${domainPerPage}${qParam}`
      );
      if (Array.isArray(data)) {
        setDomains(data);
        setDomainTotal(data.length);
        setDomainTotalPages(1);
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      const total = Number(data.total);
      const totalPages = Math.max(1, Number(data.total_pages) || 1);
      setDomains(items);
      setDomainTotal(Number.isFinite(total) ? total : items.length);
      setDomainTotalPages(totalPages);
      if (domainPage > totalPages) {
        setDomainPage(totalPages);
      }
    } finally {
      setDomainsLoading(false);
    }
  }, [id, domainPage, domainPerPage, debouncedDomainTableQ]);

  useEffect(() => {
    loadMeta().catch((err) => setMessage(err.message));
  }, [loadMeta]);

  useEffect(() => {
    loadDomains().catch((err) => setMessage(err.message));
  }, [loadDomains]);

  const refreshAll = async () => {
    await loadMeta();
    await loadDomains();
  };

  const isAdmin = user?.role === "ADMIN";

  const runTransition = async (path: "submit" | "approve" | "apply" | "revoke") => {
    const body =
      path === "revoke"
        ? JSON.stringify({ reason: "Revogação imediata pelo administrador" })
        : JSON.stringify({});
    await apiRequest(`/api/block-lists/${id}/${path}`, { method: "POST", body });
    setMessage("Ação registrada. O DNS será atualizado após a fila do worker processar o pedido.");
    await refreshAll();
  };

  const addDomain = async () => {
    if (!domainInput.trim()) return;
    const created = await apiRequest<BlockedDomain>(`/api/block-lists/${id}/domains`, {
      method: "POST",
      body: JSON.stringify({ original_value: domainInput })
    });
    setDomainInput("");
    setDomainPage(1);
    if (!created.is_valid && created.validation_error) {
      setMessage(created.validation_error);
    } else if (created.preexisting_note?.trim()) {
      setMessage(`Incluído nesta lista. ${created.preexisting_note}`);
    } else {
      setMessage("Domínio adicionado.");
    }
    await refreshAll();
  };

  const uploadFile = async (file: File, mode: "append" | "replace") => {
    setUploadLoading(true);
    setUploadFileName(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", mode);
      const res = await fetch(`${getApiBaseUrl()}/api/block-lists/${id}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === "string" ? err.error : "Falha no upload");
      }
      const data = await res.json() as {
        preview?: { valid_count?: number; invalid_count?: number; duplicate_count?: number };
        mode?: string;
        skipped_already_in_list?: number;
        domains_removed?: number;
      };
      const v = data.preview?.valid_count ?? 0;
      const inv = data.preview?.invalid_count ?? 0;
      const dup = data.preview?.duplicate_count ?? 0;
      const skipped = Number(data.skipped_already_in_list) || 0;
      const removed = Number(data.domains_removed) || 0;

      let msg =
        data.mode === "replace"
          ? `Importação em modo substituição: removidos ${removed} registro(s) anteriores desta lista. `
          : `Importação em modo agregar: `;
      msg += `${v} válidos, ${inv} inválidos, ${dup} duplicados no arquivo.`;
      if (skipped > 0) {
        msg += ` ${skipped} linha(s) não foram inseridas por já existirem nesta lista (ativos no banco / mesma configuração de bloqueio).`;
      }
      setMessage(msg);
      setDomainPage(1);
      await refreshAll();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploadLoading(false);
      setUploadFileName(null);
    }
  };

  const previewBulk = async () => {
    const values = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    const data = await apiRequest<Record<string, unknown>>(`/api/block-lists/${id}/domains/bulk`, {
      method: "POST",
      body: JSON.stringify({ values })
    });
    setBulkPreview(data);
  };

  const requestListRevoke = async () => {
    if (listRevokeReason.trim().length < 3) {
      setMessage("Informe o motivo da revogação (mín. 3 caracteres).");
      return;
    }
    await apiRequest(`/api/block-lists/${id}/revoke-requests`, {
      method: "POST",
      body: JSON.stringify({ reason: listRevokeReason })
    });
    setListRevokeReason("");
    setMessage("Solicitação de revogação da lista enviada para aprovação.");
    await refreshAll();
  };

  const requestDomainRevoke = async () => {
    if (!domainRevoke) return;
    await apiRequest(`/api/blocked-domains/${domainRevoke.id}/revoke-requests`, {
      method: "POST",
      body: JSON.stringify({ reason: domainRevoke.reason })
    });
    setDomainRevoke(null);
    setMessage("Solicitação de revogação do domínio enviada para aprovação.");
    await refreshAll();
  };

  if (!list) {
    return (
      <AppShell>
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-sm text-slate-500">Carregando lista…</p>
        </div>
      </AppShell>
    );
  }

  const applied = list.status === "APPLIED";
  const totalDomains = Number(domainTotal) || 0;
  const totalPagesSafe = Math.max(1, Number(domainTotalPages) || 1);
  const rangeStart = totalDomains === 0 ? 0 : (domainPage - 1) * domainPerPage + 1;
  const rangeEnd = Math.min(domainPage * domainPerPage, totalDomains);
  const canQuickApply = isAdmin && list.status === "APPROVED";
  const canReplaceUpload =
    isAdmin || list.status === "DRAFT" || list.status === "PENDING_APPROVAL";

  return (
    <AppShell>
      <div className="space-y-5 pb-10">
        {/* Cabeçalho da página: identidade + ações rápidas */}
        <header className="border-b border-slate-200/90 pb-5">
          <Link
            href="/block-lists"
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            <span aria-hidden>←</span> Voltar às listas
          </Link>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 lg:text-3xl">{list.title}</h1>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {list.description?.trim() || "Use a área principal para gerir domínios. À direita: fluxo, tramitação e revogação."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", statusStyle(list.status))}>
                  {list.status}
                </span>
                <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-900 ring-1 ring-indigo-100">
                  {list.dns_action}
                </span>
                <span className="text-xs text-slate-600">
                  Origem <strong className="text-slate-800">{list.source_type}</strong>
                  {list.process_number?.trim() && (
                    <>
                      {" "}
                      · Proc. <strong className="font-mono text-slate-800">{list.process_number}</strong>
                    </>
                  )}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-stretch">
              {canQuickApply && (
                <Button className="bg-blue-600 shadow-sm hover:bg-blue-700" onClick={() => runTransition("apply")}>
                  Aplicar no DNS agora
                </Button>
              )}
              <Link
                href="/revocation-requests"
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                Fila de revogações
              </Link>
            </div>
          </div>
        </header>

        {message && (
          <div
            role="status"
            className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950 shadow-sm"
          >
            {message}
          </div>
        )}

        <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start xl:gap-8 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Coluna principal: domínios = foco do trabalho */}
          <section className="min-w-0 space-y-4" aria-labelledby="domains-heading">
            <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04]">
              <div className="border-b border-slate-100 bg-gradient-to-r from-blue-600/[0.07] to-transparent px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 id="domains-heading" className="text-lg font-semibold text-slate-900">
                      Domínios bloqueados
                    </h2>
                    <p className="text-sm text-slate-600">
                      <strong className="tabular-nums text-slate-900">{totalDomains.toLocaleString("pt-BR")}</strong> no total
                      · importação, inclusão manual e tabela paginada.
                    </p>
                  </div>
                  {list.expires_at && (
                    <p className="text-xs text-amber-800">
                      Validade: <strong>{new Date(list.expires_at).toLocaleString()}</strong>
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-start">
                  <div className="min-w-0 flex-1 lg:min-w-[240px]">
                    <label className="text-xs font-medium text-slate-600">Incluir domínio</label>
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        className="min-w-0 flex-1"
                        placeholder="https://site.com/… ou site.com"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDomain())}
                      />
                      <Button type="button" onClick={addDomain} className="h-10 shrink-0 bg-slate-900 hover:bg-slate-800">
                        Adicionar
                      </Button>
                    </div>
                  </div>
                  <div className="min-w-0 w-full flex-1 lg:min-w-[280px] lg:max-w-xl">
                    <label className="text-xs font-medium text-slate-600">Arquivo .txt / .csv</label>
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        type="file"
                        accept=".txt,.csv"
                        disabled={uploadLoading}
                        className="h-10 min-w-0 flex-1 cursor-pointer py-0 pl-0 pr-2 text-sm leading-none file:mr-3 file:inline-flex file:h-9 file:cursor-pointer file:items-center file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:text-sm file:font-medium file:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            if (totalDomains > 0) {
                              setUploadChoice({ file: f });
                            } else {
                              void uploadFile(f, "append");
                            }
                          }
                          e.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={uploadLoading}
                        className="h-10 shrink-0 border-slate-300 px-3 whitespace-nowrap sm:self-center disabled:opacity-60"
                        onClick={previewBulk}
                      >
                        Analisar bloco (sem gravar)
                      </Button>
                    </div>
                  </div>
                </div>

                {uploadLoading && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950 shadow-sm"
                  >
                    <span
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100"
                      aria-hidden
                    >
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">Enviando e processando o arquivo…</p>
                      {uploadFileName && (
                        <p className="mt-0.5 truncate font-mono text-xs text-blue-900/90">{uploadFileName}</p>
                      )}
                      <p className="mt-1 text-xs text-blue-800/80">Não feche a página até concluir.</p>
                    </div>
                  </div>
                )}

                <details className="group rounded-xl border border-slate-200 bg-slate-50/40 open:border-blue-200/60 open:bg-white">
                  <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-slate-700 marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center justify-between gap-2">
                      Colar várias linhas (bulk)
                      <span className="text-xs font-normal text-slate-500 group-open:hidden">Expandir</span>
                      <span className="hidden text-xs font-normal text-slate-500 group-open:inline">Recolher</span>
                    </span>
                  </summary>
                  <div className="border-t border-slate-100 px-3 pb-3 pt-2">
                    <textarea
                      className="min-h-[88px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800"
                      placeholder="Uma linha por valor…"
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                    />
                    {bulkPreview != null && (
                      <pre className="mt-2 max-h-36 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">
                        {JSON.stringify(bulkPreview, null, 2)}
                      </pre>
                    )}
                  </div>
                </details>

                <div className="space-y-3 rounded-xl bg-slate-50 px-3 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <label className="text-xs font-medium text-slate-600">Buscar na tabela</label>
                      <Input
                        className="mt-1 font-mono text-sm"
                        placeholder="Filtra por texto no domínio normalizado ou valor original…"
                        value={domainTableQ}
                        onChange={(e) => setDomainTableQ(e.target.value)}
                      />
                    </div>
                    {debouncedDomainTableQ.trim() && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 border-slate-300"
                        onClick={() => setDomainTableQ("")}
                      >
                        Limpar busca
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-700">
                    {domainsLoading ? (
                      <span className="text-slate-500">Carregando…</span>
                    ) : totalDomains === 0 ? (
                      debouncedDomainTableQ.trim()
                        ? "Nenhum domínio corresponde à busca."
                        : "Nenhum domínio ainda."
                    ) : (
                      <>
                        <span className="tabular-nums">
                          {rangeStart}–{rangeEnd} de {totalDomains.toLocaleString("pt-BR")}
                        </span>
                        {debouncedDomainTableQ.trim() && (
                          <span className="ml-2 text-slate-500">(filtro ativo)</span>
                        )}
                      </>
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-slate-600">Por página</label>
                    <select
                      className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
                      value={domainPerPage}
                      onChange={(e) => {
                        setDomainPerPage(Number(e.target.value) as (typeof PER_PAGE_OPTIONS)[number]);
                        setDomainPage(1);
                      }}
                    >
                      {PER_PAGE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={domainPage <= 1 || domainsLoading}
                      onClick={() => setDomainPage((p) => Math.max(1, p - 1))}
                    >
                      Anterior
                    </Button>
                    <span className="min-w-[4.5rem] text-center text-sm tabular-nums text-slate-700">
                      {domainPage}/{totalPagesSafe}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={domainPage >= totalPagesSafe || domainsLoading}
                      onClick={() => setDomainPage((p) => p + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="max-h-[min(65vh,680px)] overflow-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="px-3 py-3">Original</th>
                          <th className="px-3 py-3">Normalizado</th>
                          <th className="px-3 py-3">Situação</th>
                          <th className="w-28 px-3 py-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {domains.map((d) => (
                          <tr key={d.id} className="hover:bg-slate-50/90">
                            <td className="max-w-[260px] truncate px-3 py-2.5 text-slate-800" title={d.original_value}>
                              {d.original_value}
                            </td>
                            <td
                              className="max-w-xs truncate px-3 py-2.5 font-mono text-xs text-slate-700"
                              title={d.normalized_domain}
                            >
                              {d.normalized_domain || "—"}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-col gap-1">
                                {d.revoked_at ? (
                                  <span className="text-xs font-semibold text-rose-700">Revogado</span>
                                ) : !d.is_valid ? (
                                  <span className="text-xs text-amber-800" title={d.validation_error}>
                                    Inválido
                                  </span>
                                ) : d.preexisting_note?.trim() ? (
                                  <span
                                    className="w-fit rounded-md bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-900"
                                    title={d.preexisting_note}
                                  >
                                    Já Existe
                                  </span>
                                ) : (
                                  <span className="text-xs font-semibold text-emerald-700">Ativo</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {applied && d.is_valid && !d.revoked_at && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs"
                                  onClick={() => setDomainRevoke({ id: d.id, reason: "" })}
                                >
                                  Revogar
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {!domainsLoading && domains.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-6 py-16 text-center">
                              <p className="font-medium text-slate-700">Nenhum domínio nesta página</p>
                              <p className="mt-1 text-sm text-slate-500">
                                Adicione acima, importe um arquivo ou ajuste a paginação.
                              </p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Barra lateral: contexto + ações (sticky no desktop) */}
          <aside className="mt-8 space-y-4 xl:mt-0 xl:sticky xl:top-5 xl:max-h-[calc(100vh-1.5rem)] xl:space-y-4 xl:overflow-y-auto xl:pb-6">
            <Card className="overflow-hidden border-slate-200/90 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-slate-50/80 py-3">
                <CardTitle className="text-sm font-semibold">Resumo da lista</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 text-sm">
                <div className="rounded-xl bg-slate-900 px-4 py-3 text-white">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Domínios</p>
                  <p className="text-2xl font-bold tabular-nums tracking-tight">{totalDomains.toLocaleString("pt-BR")}</p>
                </div>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between gap-2 border-b border-slate-100 py-1.5">
                    <dt className="text-slate-500">Origem</dt>
                    <dd className="font-medium text-slate-900">{list.source_type}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-slate-100 py-1.5">
                    <dt className="text-slate-500">Processo</dt>
                    <dd className="max-w-[55%] break-all text-right font-mono text-slate-900">{list.process_number || "—"}</dd>
                  </div>
                  {list.dns_action === "REDIRECT" && (
                    <div className="flex justify-between gap-2 border-b border-slate-100 py-1.5">
                      <dt className="text-slate-500">Redirect IP</dt>
                      <dd className="font-mono text-slate-900">{list.redirect_ip ?? "—"}</dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>

            <Card className="border-slate-200/90 shadow-sm">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Próximos passos</CardTitle>
                <CardDescription className="text-xs leading-snug">
                  Rascunho → envio → aprovação → DNS. Ações dependem do perfil e do status.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 pb-4">
                <Button variant="outline" size="sm" className="justify-start border-slate-300" onClick={() => runTransition("submit")}>
                  Enviar para aprovação
                </Button>
                {isAdmin && (
                  <>
                    <Button variant="outline" size="sm" className="justify-start border-slate-300" onClick={() => runTransition("approve")}>
                      Aprovar lista
                    </Button>
                    <Button size="sm" className="justify-start bg-blue-600 hover:bg-blue-700" onClick={() => runTransition("apply")}>
                      Solicitar aplicação no DNS
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start border-rose-200 text-rose-800 hover:bg-rose-50"
                      onClick={() => runTransition("revoke")}
                    >
                      Revogar lista (admin, imediato)
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200/90 shadow-sm">
              <CardContent className="p-4">
                <TramitationTimeline list={list} />
              </CardContent>
            </Card>

            <Card className="border-slate-200/90 shadow-sm">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Revogação</CardTitle>
                <CardDescription className="text-xs">
                  Com aprovação. Acompanhe em{" "}
                  <Link href="/revocation-requests" className="font-medium text-blue-600">
                    Revogações
                  </Link>
                  .
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pb-4">
                {applied ? (
                  <>
                    <label className="text-xs font-medium text-slate-700">Solicitar revogação da lista inteira</label>
                    <textarea
                      className="min-h-[72px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Motivo (mín. 3 caracteres)…"
                      value={listRevokeReason}
                      onChange={(e) => setListRevokeReason(e.target.value)}
                    />
                    <Button variant="outline" size="sm" className="w-full border-slate-300" onClick={requestListRevoke}>
                      Enviar solicitação
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-slate-600">
                    Disponível quando a lista estiver <strong>APPLIED</strong> no DNS.
                  </p>
                )}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Histórico aqui</p>
                  <ul className="mt-2 max-h-36 space-y-1.5 overflow-y-auto text-xs">
                    {revReqs.length === 0 && <li className="text-slate-500">Nenhuma solicitação.</li>}
                    {revReqs.map((r) => (
                      <li key={r.id} className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                        <span className="font-medium text-slate-800">{r.kind === "LIST" ? "Lista" : "Domínio"}</span>{" "}
                        <span className="text-slate-600">{r.status}</span>
                        <div className="mt-0.5 text-slate-600 line-clamp-2">{r.reason}</div>
                        {r.kind === "DOMAIN" && (r.blocked_domain_label || r.blocked_domain_id) && (
                          <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                            {r.blocked_domain_label || r.blocked_domain_id}
                          </div>
                        )}
                        {(r.requested_by_name || r.requested_by_email) && (
                          <div className="mt-0.5 text-[10px] text-slate-500">
                            {r.requested_by_name} {r.requested_by_email ? `· ${r.requested_by_email}` : ""}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>

        {uploadChoice && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-mode-title"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setUploadChoice(null);
            }}
          >
            <div className="max-w-md" onMouseDown={(e) => e.stopPropagation()}>
              <Card className="shadow-xl">
                <CardHeader>
                  <CardTitle>
                    <span id="upload-mode-title">Importar arquivo</span>
                  </CardTitle>
                  <CardDescription>
                    Esta lista já tem{" "}
                    <strong className="text-slate-800">{totalDomains.toLocaleString("pt-BR")}</strong> domínio(s).
                    O arquivo <span className="font-mono text-slate-700">{uploadChoice.file.name}</span> deve{" "}
                    <strong>somar</strong> aos existentes ou <strong>substituir</strong> toda a lista atual?
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-slate-600">
                    Duplicados dentro do arquivo são consolidados; ao agregar, entradas já ativas nesta lista não são
                    repetidas (alinha com o que já vai para o Unbound). Substituir apaga todos os registros desta lista
                    antes de importar.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => setUploadChoice(null)}>
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      className="bg-slate-900 hover:bg-slate-800"
                      onClick={() => {
                        const f = uploadChoice.file;
                        setUploadChoice(null);
                        void uploadFile(f, "append");
                      }}
                    >
                      Agregar à lista
                    </Button>
                    <Button
                      type="button"
                      disabled={!canReplaceUpload}
                      title={
                        !canReplaceUpload
                          ? "Substituir lista aplicada exige administrador"
                          : "Remove todos os domínios desta lista e importa só este ficheiro"
                      }
                      className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                      onClick={() => {
                        const f = uploadChoice.file;
                        setUploadChoice(null);
                        void uploadFile(f, "replace");
                      }}
                    >
                      Substituir lista inteira
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {domainRevoke && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setDomainRevoke(null);
            }}
          >
            <div className="max-w-md" onMouseDown={(e) => e.stopPropagation()}>
              <Card className="shadow-xl">
              <CardHeader>
                <CardTitle>Revogar domínio</CardTitle>
                <CardDescription>Informe o motivo. Um administrador deverá aprovar.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <textarea
                  className="min-h-[96px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Motivo…"
                  value={domainRevoke.reason}
                  onChange={(e) => setDomainRevoke({ ...domainRevoke, reason: e.target.value })}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setDomainRevoke(null)}>
                    Cancelar
                  </Button>
                  <Button className="bg-blue-600 hover:bg-blue-700" onClick={requestDomainRevoke}>
                    Enviar solicitação
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
