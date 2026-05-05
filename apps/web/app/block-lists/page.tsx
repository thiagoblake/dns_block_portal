"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

const createSchema = z.object({
  title: z.string().min(1, "Informe um título"),
  source_type: z.enum(["JUDICIAL", "ADMINISTRATIVO", "SEGURANCA", "OUTRO"]),
  process_number: z.string().optional(),
  description: z.string().optional(),
  dns_action: z.enum(["ALWAYS_NXDOMAIN", "ALWAYS_NULL", "REFUSE", "REDIRECT"]),
  redirect_ip: z.string().optional(),
  expires_at: z.string().optional()
});

type CreateForm = z.infer<typeof createSchema>;

type BlockList = {
  id: string;
  title: string;
  source_type: string;
  process_number?: string;
  dns_action: string;
  status: string;
  expires_at?: string | null;
  created_at: string;
};

type BlockListsPageResponse = {
  items: BlockList[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  domain_hint?: string;
};

const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;

const FORM_DEFAULTS: CreateForm = {
  title: "",
  source_type: "JUDICIAL",
  process_number: "",
  description: "",
  dns_action: "ALWAYS_NXDOMAIN",
  redirect_ip: "",
  expires_at: ""
};

function statusStyle(status: string) {
  switch (status) {
    case "APPLIED":
      return "bg-emerald-100 text-emerald-900";
    case "APPROVED":
      return "bg-blue-100 text-blue-900";
    case "PENDING_APPROVAL":
      return "bg-amber-100 text-amber-900";
    case "DRAFT":
      return "bg-slate-100 text-slate-800";
    case "REVOKED":
    case "EXPIRED":
      return "bg-rose-100 text-rose-900";
    case "FAILED":
      return "bg-orange-100 text-orange-900";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

function buildListQuery(params: {
  page: number;
  perPage: number;
  q: string;
  processNumber: string;
  domain: string;
  status: string;
  sourceType: string;
  dnsAction: string;
}) {
  const sp = new URLSearchParams();
  sp.set("page", String(params.page));
  sp.set("per_page", String(params.perPage));
  if (params.q.trim()) sp.set("q", params.q.trim());
  if (params.processNumber.trim()) sp.set("process_number", params.processNumber.trim());
  if (params.domain.trim()) sp.set("domain", params.domain.trim());
  if (params.status) sp.set("status", params.status);
  if (params.sourceType) sp.set("source_type", params.sourceType);
  if (params.dnsAction) sp.set("dns_action", params.dnsAction);
  const qs = sp.toString();
  return qs ? `/api/block-lists?${qs}` : "/api/block-lists";
}

export default function BlockListsPage() {
  const [data, setData] = useState<BlockListsPageResponse | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<(typeof PER_PAGE_OPTIONS)[number]>(10);
  const [qInput, setQInput] = useState("");
  const [processInput, setProcessInput] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [debouncedProcess, setDebouncedProcess] = useState("");
  const [debouncedDomain, setDebouncedDomain] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("");
  const [dnsActionFilter, setDnsActionFilter] = useState("");
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting, isDirty }
  } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: FORM_DEFAULTS
  });

  const action = watch("dns_action");

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(qInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedProcess(processInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [processInput]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedDomain(domainInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [domainInput]);

  const load = useCallback(async () => {
    const url = buildListQuery({
      page,
      perPage,
      q: debouncedQ,
      processNumber: debouncedProcess,
      domain: debouncedDomain,
      status: statusFilter,
      sourceType: sourceTypeFilter,
      dnsAction: dnsActionFilter
    });
    const raw = await apiRequest<BlockListsPageResponse | BlockList[]>(url);
    if (Array.isArray(raw)) {
      setData({
        items: raw,
        total: raw.length,
        page: 1,
        per_page: raw.length || 10,
        total_pages: 1
      });
      return;
    }
    setData({
      items: Array.isArray(raw.items) ? raw.items : [],
      total: Number(raw.total) || 0,
      page: Number(raw.page) || 1,
      per_page: Number(raw.per_page) || perPage,
      total_pages: Math.max(1, Number(raw.total_pages) || 1),
      domain_hint: raw.domain_hint
    });
  }, [page, perPage, debouncedQ, debouncedProcess, debouncedDomain, statusFilter, sourceTypeFilter, dnsActionFilter]);

  useEffect(() => {
    load().catch((err) => setMessage(err.message));
  }, [load]);

  const openCreateModal = () => {
    reset(FORM_DEFAULTS);
    setCreateOpen(true);
  };

  const requestCloseCreate = useCallback(() => {
    if (isDirty) {
      if (!window.confirm("Há dados não salvos no formulário. Fechar e descartar?")) {
        return;
      }
    }
    reset(FORM_DEFAULTS);
    setCreateOpen(false);
  }, [isDirty, reset]);

  useEffect(() => {
    if (!createOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestCloseCreate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createOpen, requestCloseCreate]);

  const onCreate = async (form: CreateForm) => {
    const payload: Record<string, unknown> = { ...form };
    if (form.expires_at) {
      payload.expires_at = new Date(form.expires_at).toISOString();
    } else {
      delete payload.expires_at;
    }
    await apiRequest("/api/block-lists", { method: "POST", body: JSON.stringify(payload) });
    reset(FORM_DEFAULTS);
    setCreateOpen(false);
    setMessage("Lista criada. Abra o detalhe para domínios e envio para aprovação.");
    await load();
  };

  const lists = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPagesSafe = Math.max(1, data?.total_pages ?? 1);
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, total);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Listas de bloqueio</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Crie listas, importe CSV/TXT no detalhe e acompanhe o fluxo até a aplicação no Unbound. Remoções no DNS são{" "}
              <strong>incrementais</strong>: o arquivo é regenerado a partir do estado atual do banco.
            </p>
          </div>
          <Button className="shrink-0 bg-blue-600 hover:bg-blue-700" type="button" onClick={openCreateModal}>
            Nova lista
          </Button>
        </div>

        {message && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</div>
        )}
        {data?.domain_hint && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{data.domain_hint}</div>
        )}

        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/80">
            <CardTitle>Todas as listas</CardTitle>
            <CardDescription>
              Use <strong>Domínio bloqueado</strong> para listar só listas que contêm aquele host; busca geral cobre título, descrição e processo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-nowrap lg:items-end lg:gap-3 lg:overflow-x-auto lg:pb-1 xl:gap-4">
              <div className="min-w-0 flex-1 lg:min-w-[12rem]">
                <label className="text-xs font-medium text-slate-600">Busca geral</label>
                <Input
                  className="mt-1"
                  placeholder="Título, descrição ou nº processo…"
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                />
              </div>
              <div className="min-w-0 flex-1 lg:min-w-[11rem]">
                <label className="text-xs font-medium text-slate-600">Domínio bloqueado</label>
                <Input
                  className="mt-1 font-mono text-sm"
                  placeholder="ex.: site.com"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  title="Mostra apenas listas que já contêm este domínio (ativo)"
                />
              </div>
              <div className="w-full shrink-0 lg:w-[9.75rem]">
                <label className="text-xs font-medium text-slate-600">Processo / ofício</label>
                <Input
                  className="mt-1"
                  placeholder="Ex.: 1234…"
                  value={processInput}
                  onChange={(e) => setProcessInput(e.target.value)}
                />
              </div>
              <div className="w-full shrink-0 lg:w-[11rem]">
                <label className="text-xs font-medium text-slate-600">Status</label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Todos</option>
                  <option value="DRAFT">Rascunho</option>
                  <option value="PENDING_APPROVAL">Pendente aprovação</option>
                  <option value="APPROVED">Aprovada</option>
                  <option value="APPLIED">Aplicada</option>
                  <option value="REVOKED">Revogada</option>
                  <option value="EXPIRED">Expirada</option>
                  <option value="FAILED">Falhou</option>
                </select>
              </div>
              <div className="w-full shrink-0 lg:w-[11rem]">
                <label className="text-xs font-medium text-slate-600">Origem</label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                  value={sourceTypeFilter}
                  onChange={(e) => {
                    setSourceTypeFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Todas</option>
                  <option value="JUDICIAL">Judicial</option>
                  <option value="ADMINISTRATIVO">Administrativo</option>
                  <option value="SEGURANCA">Segurança</option>
                  <option value="OUTRO">Outro</option>
                </select>
              </div>
              <div className="w-full shrink-0 lg:w-[12.5rem]">
                <label className="text-xs font-medium text-slate-600">Ação DNS</label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                  value={dnsActionFilter}
                  onChange={(e) => {
                    setDnsActionFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Todas</option>
                  <option value="ALWAYS_NXDOMAIN">ALWAYS_NXDOMAIN</option>
                  <option value="ALWAYS_NULL">ALWAYS_NULL</option>
                  <option value="REFUSE">REFUSE</option>
                  <option value="REDIRECT">REDIRECT</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-700">
                {total === 0 ? (
                  "Nenhuma lista neste filtro."
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
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Lista</th>
                    <th className="px-4 py-3">Processo / ofício</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Ação DNS</th>
                    <th className="px-4 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {lists.map((list) => (
                    <tr key={list.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{list.title}</p>
                        <p className="text-xs text-slate-500">{list.source_type}</p>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-slate-700" title={list.process_number}>
                        {list.process_number?.trim() || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", statusStyle(list.status))}>
                          {list.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{list.dns_action}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/block-lists/${list.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {lists.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-500">
                        Nenhuma lista encontrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-list-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) requestCloseCreate();
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 id="create-list-title" className="text-lg font-semibold text-slate-900">
                  Nova lista
                </h2>
                <p className="text-sm text-slate-600">Preencha os dados. Domínios e upload ficam no detalhe.</p>
              </div>
              <button
                type="button"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Fechar"
                onClick={requestCloseCreate}
              >
                ✕
              </button>
            </div>
            <form className="space-y-3 px-5 py-4" onSubmit={handleSubmit(onCreate)}>
              <div>
                <label className="text-xs font-medium text-slate-600">Título</label>
                <Input placeholder="Ex.: Bloqueio judicial X" {...register("title")} />
                {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Tipo de origem</label>
                <select className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" {...register("source_type")}>
                  <option value="JUDICIAL">Judicial</option>
                  <option value="ADMINISTRATIVO">Administrativo</option>
                  <option value="SEGURANCA">Segurança</option>
                  <option value="OUTRO">Outro</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Ação DNS</label>
                <select className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" {...register("dns_action")}>
                  <option value="ALWAYS_NXDOMAIN">ALWAYS_NXDOMAIN</option>
                  <option value="ALWAYS_NULL">ALWAYS_NULL</option>
                  <option value="REFUSE">REFUSE</option>
                  <option value="REDIRECT">REDIRECT</option>
                </select>
              </div>
              {action === "REDIRECT" && (
                <div>
                  <label className="text-xs font-medium text-slate-600">IP de destino</label>
                  <Input placeholder="10.10.10.10" {...register("redirect_ip")} />
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-slate-600">Nº processo / ofício</label>
                <Input {...register("process_number")} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Descrição / motivo</label>
                <textarea
                  className="mt-1 min-h-[72px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  {...register("description")}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Validade (opcional)</label>
                <Input type="datetime-local" {...register("expires_at")} />
                <p className="mt-1 text-xs text-slate-500">Se preenchido, a lista deixa de vigorar na data indicada.</p>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={requestCloseCreate}>
                  Cancelar
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                  Criar lista
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
