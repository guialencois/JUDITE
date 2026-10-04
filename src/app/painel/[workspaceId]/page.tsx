import { podeAgir } from "@/lib/trafego/acesso";
import { PADRAO_AUMENTO_PERCENT, PADRAO_MAX_SEM_APROVACAO, PADRAO_MENSAL_MAX } from "@/lib/trafego/limites";
import { NOME_PLATAFORMA, type Plataforma } from "@/lib/trafego/tipos";
import { cancelarConvite, convidar, salvarLimites } from "./actions";
import { carregarWorkspace } from "./carregar";

const ERROS: Record<string, string> = {
  convite: "Não foi possível criar o convite. Confira o e-mail (ele pode já ter sido convidado).",
  limites: "Não foi possível salvar os limites. Confira os valores.",
  "limites-migracao": "Os outros limites foram salvos, mas o orçamento mensal ainda não existe no banco: aplique a migração da Etapa 5 no Supabase (veja docs/PENDENTE.md). Até lá vale o padrão de R$ 2.000.",
};
const AVISOS: Record<string, string> = {
  convite: "Convite criado. A pessoa já pode criar a conta com esse e-mail na tela de login.",
  limites: "Limites salvos.",
};
const PAPEIS: Record<string, string> = { owner: "Dono", admin: "Admin", member: "Membro" };

const ROTULOS_LIMITE: Record<string, { rotulo: string; ajuda: string }> = {
  orcamento_max_sem_aprovacao: { rotulo: "Orçamento máximo sem aprovação (R$/dia)", ajuda: "Acima disso a JUDITE pede sua confirmação." },
  aumento_max_por_vez_percent: { rotulo: "Aumento máximo por vez (%)", ajuda: "Aumentos maiores pedem confirmação." },
  orcamento_mensal_max: { rotulo: "Orçamento mensal máximo (R$)", ajuda: "Soma de todas as plataformas no mês. O que passar disso pede confirmação." },
  custos_percent: { rotulo: "Custos do negócio (% do faturamento)", ajuda: "Usado para calcular lucro e margem." },
};

/** Valor mostrado quando o limite ainda não está gravado no banco (é o mesmo padrão que os freios usam). */
const PADROES_LIMITE: Record<string, number> = {
  orcamento_max_sem_aprovacao: PADRAO_MAX_SEM_APROVACAO,
  aumento_max_por_vez_percent: PADRAO_AUMENTO_PERCENT,
  orcamento_mensal_max: PADRAO_MENSAL_MAX,
};

const campo = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100";
const botao = "rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950";

export default async function WorkspacePage(props: PageProps<"/painel/[workspaceId]">) {
  const { workspaceId } = await props.params;
  const { supabase, workspace, papel } = await carregarWorkspace(workspaceId);
  const gestor = podeAgir(papel);
  const params = await props.searchParams;
  const erro = typeof params.erro === "string" ? ERROS[params.erro] : undefined;
  const aviso = typeof params.aviso === "string" ? AVISOS[params.aviso] : undefined;

  const [{ data: membros }, { data: convites }, { data: config }, { data: contas }] = await Promise.all([
    supabase.from("members").select("user_id, role, created_at").eq("workspace_id", workspace.id).order("created_at"),
    gestor
      ? supabase.from("convites").select("id, email, role, aceito_em").eq("workspace_id", workspace.id).order("criado_em", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; email: string; role: string; aceito_em: string | null }[] }),
    supabase.from("trafego_config").select("chave, valor").eq("workspace_id", workspace.id),
    supabase.from("trafego_contas").select("plataforma, conta_externa, nome, ativo").eq("workspace_id", workspace.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-4 py-6">
      <header>
        <h1 className="font-serif text-3xl">{workspace.name}</h1>
        <p className="text-sm text-zinc-500">Seu papel: {PAPEIS[papel]}</p>
      </header>

      {erro && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{erro}</p>}
      {aviso && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{aviso}</p>}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Contas de anúncio</h2>
        {contas && contas.length > 0 ? (
          <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {contas.map((c) => (
              <li key={c.plataforma + c.conta_externa} className="flex justify-between px-4 py-3 text-sm">
                <span>{c.nome ?? c.conta_externa}</span>
                <span className="text-zinc-500">{NOME_PLATAFORMA[c.plataforma as Plataforma] ?? c.plataforma} · {c.conta_externa}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">Nenhuma conta de anúncio ligada a este workspace.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Limites da IA</h2>
        <form action={salvarLimites} className="grid gap-4 rounded-xl border border-zinc-800 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="workspaceId" value={workspace.id} />
          {Object.entries(ROTULOS_LIMITE).map(([chave, info]) => (
            <label key={chave} className="space-y-1 text-sm">
              <span className="block">{info.rotulo}</span>
              <input
                name={chave}
                type="number"
                min={0}
                step="1"
                required
                disabled={!gestor}
                defaultValue={Number(config?.find((c) => c.chave === chave)?.valor ?? PADROES_LIMITE[chave] ?? 0)}
                className={campo}
              />
              <span className="block text-xs text-zinc-500">{info.ajuda}</span>
            </label>
          ))}
          {gestor && <div className="sm:col-span-2 lg:col-span-4"><button className={botao}>Salvar limites</button></div>}
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Equipe</h2>
        <p className="text-sm text-zinc-500">{membros?.length ?? 0} pessoa(s) com acesso. A JUDITE só aceita cadastro de quem foi convidado.</p>
        {gestor && (
          <>
            <form action={convidar} className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 p-4">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <label className="min-w-[220px] flex-1 space-y-1 text-sm">
                <span className="block">E-mail de quem vai entrar</span>
                <input name="email" type="email" required maxLength={254} className={campo} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block">Papel</span>
                <select name="role" defaultValue="member" className={campo}>
                  <option value="member">Membro (só vê)</option>
                  {papel === "owner" && <option value="admin">Admin (pode mudar campanhas)</option>}
                </select>
              </label>
              <button className={botao}>Convidar</button>
            </form>
            {convites && convites.length > 0 && (
              <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
                {convites.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span>{c.email} · {PAPEIS[c.role]}</span>
                    {c.aceito_em ? (
                      <span className="text-emerald-400">aceito</span>
                    ) : (
                      <form action={cancelarConvite}>
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <input type="hidden" name="conviteId" value={c.id} />
                        <button className="text-zinc-400 hover:text-rose-400">cancelar</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}
