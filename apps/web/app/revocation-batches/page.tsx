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
import { apiRequest, type User } from "@/lib/api";
import { cn } from "@/lib/utils";

const createSchema = z.object({
  title: z.string().min(1, "Informe um título"),
  source_type: z.enum(["JUDICIAL", "ADMINISTRATIVO", "SEGURANCA", "OUTRO"]),
  process_number: z.string().optional(),
  description: z.string().optional(),
  reason: z.string().min(3, "Motivo com pelo menos 3 caracteres")
});

type CreateForm = z.infer<typeof createSchema>;

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
  status: string;
  reason: string;
  created_at: string;
  stats: BatchStats;
};

type PageResponse = {
  items: RevocationBatch[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

const PER_PAGE = 10;

function statusStyle(status: string) {
  switch (status) {
    case "APPLIED":
      return "bg-emerald-100 text-emerald-900";
    case "PENDING_APPROVAL":
      return "bg-amber-100 text-amber-900";
    case "DRAFT":
      return "bg-slate-100 text-slate-800";
    case "REJECTED":
      return "bg-rose-100 text-rose-900";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "DRAFT":
      return "Rascunho";
    case "PENDING_APPROVAL":
      return "Pendente aprovação";
    case "APPLIED":
      return "Aplicada";
    case "REJECTED":
      return "Rejeitada";
    default:
      return status;
  }
}

export default function RevocationBatchesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<PageResponse | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      title: "",
      source_type: "JUDICIAL",
      process_number: "",
      description: "",
      reason: ""
    }
  });

  const isAdmin = user?.role === "ADMIN";

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (statusFilter) sp.set("status", statusFilter);
    const raw = await apiRequest<PageResponse>(`/api/revocation-batches?${sp}`);
    setData(raw);
  }, [page, statusFilter]);

  useEffect(() => {
    apiRequest<User>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    load().catch((err) => setMessage(err.message));
  }, [load]);

  const onCreate = async (form: CreateForm) => {
    const created = await apiRequest<{ id: string }>("/api/revocation-batches", {
      method: "POST",
      body: JSON.stringify(form)
    });
    reset();
    setCreateOpen(false);
    window.location.href = `/revocation-batches/${created.id}`;
  };

  const onDelete = async (batch: RevocationBatch) => {
    if (!window.confirm(`Excluir o lote "${batch.title}"?`)) return;
    await apiRequest(`/api/revocation-batches/${batch.id}`, { method: "DELETE" });
    setMessage("Lote excluído.");
    await load();
  };

  const items = data?.items ?? [];
  const totalPages = Math.max(1, data?.total_pages ?? 1);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Revogação em lote</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Envie uma lista de domínios para revogar. O sistema localiza em quais listas aplicadas eles estão e segue
              o fluxo rascunho → aprovação → revogação no DNS.
            </p>
          </div>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setCreateOpen(true)}>
            Novo lote
          </Button>
        </div>

        {message && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</div>
        )}

        <Card>
          <CardHeader className="border-b border-slate-100 bg-slate-50/80">
            <CardTitle>Lotes de revogação</CardTitle>
            <CardDescription>Upload de domínios, identificação automática nas listas existentes e aprovação.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-48">
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
                  <option value="APPLIED">Aplicada</option>
                  <option value="REJECTED">Rejeitada</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Lote</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Elegíveis</th>
                    <th className="px-4 py-3">Não encontrados</th>
                    <th className="px-4 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((batch) => (
                    <tr key={batch.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{batch.title}</p>
                        <p className="text-xs text-slate-500">{batch.source_type}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", statusStyle(batch.status))}>
                          {statusLabel(batch.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{batch.stats?.matched ?? 0}</td>
                      <td className="px-4 py-3 tabular-nums">{batch.stats?.not_found ?? 0}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          {isAdmin && (batch.status === "DRAFT" || batch.status === "PENDING_APPROVAL") && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-rose-200 text-rose-800"
                              onClick={() => onDelete(batch)}
                            >
                              Excluir
                            </Button>
                          )}
                          <Link href={`/revocation-batches/${batch.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                            Abrir
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                        Nenhum lote encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <span className="text-sm text-slate-600">
                {page} / {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Novo lote de revogação</h2>
            <p className="mt-1 text-sm text-slate-600">Após criar, faça upload ou cole os domínios no detalhe.</p>
            <form className="mt-4 space-y-3" onSubmit={handleSubmit(onCreate)}>
              <div>
                <label className="text-xs font-medium text-slate-600">Título</label>
                <Input {...register("title")} />
                {errors.title && <p className="text-xs text-red-600">{errors.title.message}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Tipo de origem</label>
                <select className="mt-1 h-10 w-full rounded-md border px-3 text-sm" {...register("source_type")}>
                  <option value="JUDICIAL">Judicial</option>
                  <option value="ADMINISTRATIVO">Administrativo</option>
                  <option value="SEGURANCA">Segurança</option>
                  <option value="OUTRO">Outro</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Nº processo / ofício</label>
                <Input {...register("process_number")} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Motivo da revogação</label>
                <textarea className="mt-1 min-h-[72px] w-full rounded-md border px-3 py-2 text-sm" {...register("reason")} />
                {errors.reason && <p className="text-xs text-red-600">{errors.reason.message}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Descrição (opcional)</label>
                <textarea className="mt-1 min-h-[56px] w-full rounded-md border px-3 py-2 text-sm" {...register("description")} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                  Criar lote
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
