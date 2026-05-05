"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { User, apiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

const schema = z.object({
  name: z.string().min(1, "Informe o nome"),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
  role: z.enum(["ADMIN", "OPERADOR", "AUDITOR"])
});

type FormData = z.infer<typeof schema>;

const FORM_DEFAULTS: FormData = {
  name: "",
  email: "",
  password: "",
  role: "OPERADOR"
};

type UsersPageResponse = {
  items: User[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

const PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;

function buildQuery(params: { page: number; perPage: number; q: string; role: string; isActive: string }) {
  const sp = new URLSearchParams();
  sp.set("page", String(params.page));
  sp.set("per_page", String(params.perPage));
  if (params.q.trim()) sp.set("q", params.q.trim());
  if (params.role) sp.set("role", params.role);
  if (params.isActive) sp.set("is_active", params.isActive);
  return `/api/users?${sp.toString()}`;
}

export default function UsersPage() {
  const [data, setData] = useState<UsersPageResponse | null>(null);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<(typeof PER_PAGE_OPTIONS)[number]>(20);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: FORM_DEFAULTS
  });

  const load = useCallback(async () => {
    const url = buildQuery({ page, perPage, q, role: roleFilter, isActive: activeFilter });
    const raw = await apiRequest<UsersPageResponse | User[]>(url);
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
  }, [page, perPage, q, roleFilter, activeFilter]);

  useEffect(() => {
    load().catch((err) => setMessage(err.message));
  }, [load]);

  const openCreate = () => {
    reset(FORM_DEFAULTS);
    setCreateOpen(true);
  };

  const requestCloseCreate = useCallback(() => {
    if (isDirty) {
      if (!window.confirm("Há dados não salvos. Fechar e descartar?")) return;
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

  const onSubmit = async (form: FormData) => {
    await apiRequest("/api/users", { method: "POST", body: JSON.stringify(form) });
    reset(FORM_DEFAULTS);
    setCreateOpen(false);
    setMessage("Usuário criado.");
    await load();
  };

  const toggle = async (id: string, current: boolean) => {
    await apiRequest(`/api/users/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !current })
    });
    await load();
  };

  const users = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPagesSafe = Math.max(1, data?.total_pages ?? 1);
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, total);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Usuários</h1>
            <p className="mt-1 text-sm text-slate-600">Gerencie contas do portal. Apenas administradores acessam esta tela.</p>
          </div>
          <Button className="shrink-0 bg-blue-600 hover:bg-blue-700" type="button" onClick={openCreate}>
            Novo usuário
          </Button>
        </div>

        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</div>
        )}

        <Card>
          <CardHeader className="border-b border-slate-100 bg-slate-50/80">
            <CardTitle>Listagem</CardTitle>
            <CardDescription>Filtre por nome, e-mail, perfil e situação (ativo/inativo).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <label className="text-xs font-medium text-slate-600">Busca</label>
                <Input
                  className="mt-1"
                  placeholder="Nome ou e-mail"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Perfil</label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={roleFilter}
                  onChange={(e) => {
                    setRoleFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Todos</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="OPERADOR">OPERADOR</option>
                  <option value="AUDITOR">AUDITOR</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Situação</label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={activeFilter}
                  onChange={(e) => {
                    setActiveFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Todas</option>
                  <option value="true">Ativo</option>
                  <option value="false">Inativo</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-700">
                {total === 0 ? (
                  "Nenhum usuário."
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

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">E-mail</th>
                    <th className="px-4 py-3">Perfil</th>
                    <th className="px-4 py-3">Situação</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-medium text-slate-900">{user.name}</td>
                      <td className="px-4 py-3 text-slate-700">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs">{user.role}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "text-xs font-semibold",
                            user.is_active ? "text-emerald-700" : "text-slate-500"
                          )}
                        >
                          {user.is_active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" onClick={() => toggle(user.id, user.is_active)}>
                          {user.is_active ? "Desativar" : "Ativar"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                        Nenhum usuário encontrado.
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
          aria-labelledby="create-user-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) requestCloseCreate();
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 id="create-user-title" className="text-lg font-semibold text-slate-900">
                  Novo usuário
                </h2>
                <p className="text-sm text-slate-600">Senha mínima de 6 caracteres. O e-mail deve ser único.</p>
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
            <form className="space-y-3 px-5 py-4" onSubmit={handleSubmit(onSubmit)}>
              <div>
                <label className="text-xs font-medium text-slate-600">Nome</label>
                <Input className="mt-1" {...register("name")} />
                {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">E-mail</label>
                <Input className="mt-1" type="email" {...register("email")} />
                {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Senha</label>
                <Input className="mt-1" type="password" autoComplete="new-password" {...register("password")} />
                {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Perfil</label>
                <select className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" {...register("role")}>
                  <option value="ADMIN">ADMIN</option>
                  <option value="OPERADOR">OPERADOR</option>
                  <option value="AUDITOR">AUDITOR</option>
                </select>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={requestCloseCreate}>
                  Cancelar
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                  Criar usuário
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
