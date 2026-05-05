"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { apiRequest, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "admin@local.test",
      password: "admin123"
    }
  });

  const onSubmit = async (data: FormData) => {
    const response = await apiRequest<{ token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(data)
    });
    setToken(response.token);
    router.push("/dashboard");
  };

  return (
    <div className="relative min-h-screen bg-slate-950 px-4 py-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.35),_transparent_55%)]" />
      <div className="relative mx-auto flex max-w-md flex-col gap-6">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Uni Internet</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">DNS Block Portal</h1>
          <p className="mt-2 text-sm text-slate-400">Gestão de bloqueios DNS com auditoria e aprovação.</p>
        </div>
        <Card className="border-slate-800 bg-slate-900/80 shadow-2xl backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg text-white">Entrar</CardTitle>
            <CardDescription className="text-slate-400">Use o e-mail e a senha fornecidos pelo administrador.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
              <div>
                <label className="text-xs font-medium text-slate-400">E-mail</label>
                <Input className="mt-1 border-slate-700 bg-slate-950 text-slate-100" {...register("email")} type="email" placeholder="nome@empresa.com" />
                {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">Senha</label>
                <Input className="mt-1 border-slate-700 bg-slate-950 text-slate-100" {...register("password")} type="password" placeholder="••••••••" />
                {errors.password && <p className="mt-1 text-xs text-red-400">{errors.password.message}</p>}
              </div>
              <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={isSubmitting}>
                Entrar
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
