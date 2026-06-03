import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-senha")({
  component: ResetPage,
  head: () => ({ meta: [{ title: "Definir nova senha — Lumen Pastoral" }] }),
});

function ResetPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error("Mínimo 8 caracteres."); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Senha atualizada.");
    navigate({ to: "/painel" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="font-serif text-3xl">Nova senha</h1>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-input bg-card px-4 py-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20" placeholder="Nova senha" />
        <button disabled={loading} className="w-full flex justify-center items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-altar hover:opacity-90 disabled:opacity-60">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />} Atualizar senha
        </button>
      </form>
    </div>
  );
}
