import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Search } from "lucide-react";

export const Route = createFileRoute("/superadmin/usuarios")({
  component: SuperAdminUsuarios,
  head: () => ({ meta: [{ title: "Usuários — Super Admin" }] }),
});

function SuperAdminUsuarios() {
  const [busca, setBusca] = useState("");

  const { data: membros = [], isLoading } = useQuery({
    queryKey: ["saas-all-users", busca],
    enabled: busca.length >= 3,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("membros")
        .select("id, nome_completo, email, ativo, paroquia_id, created_at, paroquias(nome)")
        .ilike("nome_completo", `%${busca}%`)
        .order("nome_completo")
        .limit(30);
      return data ?? [];
    },
  });

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Usuários</h1>
        <p className="text-sm text-white/40">Busca global de membros em todas as paróquias</p>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
        <input
          value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por nome (mínimo 3 caracteres)…"
          className="w-full max-w-md bg-[#0F1E33] border border-white/10 text-white text-sm rounded-lg py-2 pl-9 pr-3 focus:outline-none focus:border-blue-500 placeholder:text-white/30"
        />
      </div>

      {busca.length >= 3 && (
        <div className="bg-[#0F1E33] border border-white/10 rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-center text-white/30 text-sm">Buscando…</div>
          ) : membros.length === 0 ? (
            <div className="p-6 text-center text-white/30 text-sm">Nenhum resultado para "{busca}"</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-white/5">
                {["Nome", "Email", "Paróquia", "Status", "Cadastro"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-white/30 uppercase">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {membros.map((m: any) => (
                  <tr key={m.id} className="border-b border-white/5 hover:bg-white/3">
                    <td className="px-4 py-2.5 text-white/80 font-medium">{m.nome_completo}</td>
                    <td className="px-4 py-2.5 text-white/40 text-xs">{m.email ?? "—"}</td>
                    <td className="px-4 py-2.5 text-white/50 text-xs">{m.paroquias?.nome ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${m.ativo ? "bg-green-500/20 text-green-400" : "bg-white/5 text-white/30"}`}>
                        {m.ativo ? "ativo" : "inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-white/30 tabular-nums text-xs">{new Date(m.created_at).toLocaleDateString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {busca.length > 0 && busca.length < 3 && (
        <p className="text-white/30 text-sm">Digite pelo menos 3 caracteres para buscar.</p>
      )}
    </div>
  );
}
