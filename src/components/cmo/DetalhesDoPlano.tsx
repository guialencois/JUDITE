/**
 * "Ver detalhes" de uma proposta da CMO: a resposta para "por que você recomendou esta campanha?".
 * Mostra só o que está gravado no plano (campanha_rascunhos.plano); nada é calculado na tela.
 */

import { ROTULO_METRICA, ROTULO_MODO, type PlanoFinal } from "@/lib/cmo/plano";

const FUNIL: Record<string, string> = { topo: "Topo de funil (descoberta)", meio: "Meio de funil (consideração)", fundo: "Fundo de funil (decisão)" };
const SEGMENTACAO: Record<string, string> = {
  intencao_de_busca: "Intenção de busca", interesses: "Interesses", remarketing: "Remarketing (quem já visitou)", publico_semelhante: "Público semelhante",
};
const CORRESPONDENCIA: Record<string, string> = { ampla: "ampla", frase: "de frase", exata: "exata" };
export const COR_NIVEL: Record<string, string> = {
  baixa: "text-amber-300", media: "text-sky-300", alta: "text-emerald-300", baixo: "text-emerald-300", medio: "text-amber-300", alto: "text-rose-300",
};
export const ROTULO_NIVEL: Record<string, string> = { baixa: "baixa", media: "média", alta: "alta", baixo: "baixo", medio: "médio", alto: "alto" };

/** O plano vem de uma coluna jsonb: só é usado se tiver o formato desta versão. */
export function lerPlano(valor: unknown): PlanoFinal | null {
  const p = valor as Partial<PlanoFinal> | null;
  return p && p.versao === 1 && typeof p.por_que === "string" && Array.isArray(p.anuncios) && p.oportunidade ? (p as PlanoFinal) : null;
}

const titulo = "text-xs font-medium uppercase tracking-wide text-zinc-500";

function Lista({ itens }: { itens: string[] }) {
  if (!itens.length) return null;
  return <ul className="list-disc space-y-0.5 pl-5 text-zinc-300">{itens.map((i, n) => <li key={n}>{i}</li>)}</ul>;
}

export function DetalhesDoPlano({ plano }: { plano: PlanoFinal }) {
  return (
    <div className="space-y-3 border-t border-zinc-800 pt-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className={titulo}>Oportunidade</p>
          <p className="text-zinc-200">{plano.oportunidade.rotulo}</p>
          <p className="text-zinc-400">{plano.oportunidade.motivo}</p>
        </div>
        <div>
          <p className={titulo}>Como vai funcionar</p>
          <p className="text-zinc-400">{FUNIL[plano.etapa_funil] ?? plano.etapa_funil} · {SEGMENTACAO[plano.segmentacao] ?? plano.segmentacao}</p>
          <p className="text-zinc-300">{plano.estrategia}</p>
        </div>
        <div>
          <p className={titulo}>Hipótese</p>
          <p className="text-zinc-300">{plano.hipotese}</p>
          <p className="text-zinc-400">Métrica principal: {ROTULO_METRICA[plano.metrica_principal] ?? plano.metrica_principal}</p>
        </div>
        <div>
          <p className={titulo}>Impacto esperado</p>
          <p className="text-zinc-300">{plano.impacto_esperado}</p>
        </div>
        <div>
          <p className={titulo}>Orçamento</p>
          <p className="text-zinc-300">{plano.financeiro.explicacao}</p>
        </div>
        <div>
          <p className={titulo}>Risco</p>
          <p className="text-zinc-300"><span className={COR_NIVEL[plano.risco]}>{ROTULO_NIVEL[plano.risco]}</span>: {plano.risco_motivo}</p>
        </div>
      </div>

      <div>
        <p className={titulo}>Dados utilizados</p>
        <Lista itens={plano.dados_utilizados} />
        {plano.oportunidade.ressalvas.length > 0 && (
          <>
            <p className="mt-1 text-xs text-zinc-500">O que falta para a confiança subir:</p>
            <Lista itens={plano.oportunidade.ressalvas} />
          </>
        )}
      </div>

      {plano.anuncios.length > 0 && (
        <div>
          <p className={titulo}>Anúncios escritos ({plano.anuncios.length})</p>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {plano.anuncios.map((a, n) => (
              <div key={n} className="rounded-lg bg-zinc-950 p-3">
                <p className="text-xs text-zinc-500">{a.formato} · {a.cta}</p>
                <p className="font-medium text-zinc-100">{a.titulo}</p>
                <p className="text-zinc-300">{a.descricao}</p>
                <p className="mt-1 whitespace-pre-line text-xs text-zinc-400">{a.texto}</p>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-500">Os textos também estão no Creative Studio, como rascunho.</p>
        </div>
      )}
      {plano.anuncios_descartados.length > 0 && (
        <p className="text-xs text-zinc-500">
          {plano.anuncios_descartados.length} anúncio(s) da IA barrado(s) na conferência: {plano.anuncios_descartados.map((d) => `${d.titulo} (${d.motivo})`).join("; ")}.
        </p>
      )}

      {plano.palavras_chave.length > 0 && (
        <div>
          <p className={titulo}>Palavras-chave</p>
          <p className="text-zinc-300">{plano.palavras_chave.map((p) => `${p.termo} (${CORRESPONDENCIA[p.correspondencia] ?? p.correspondencia})`).join(" · ")}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {plano.ideias_de_criativo.length > 0 && (
          <div>
            <p className={titulo}>Ideias de imagem e vídeo</p>
            <Lista itens={plano.ideias_de_criativo} />
          </div>
        )}
        <div>
          <p className={titulo}>Primeiro teste A/B</p>
          <p className="text-zinc-300">{plano.teste_ab.variavel}: {plano.teste_ab.descricao}</p>
        </div>
      </div>

      {plano.alternativas.length > 0 && (
        <div>
          <p className={titulo}>Outras oportunidades que ela considerou</p>
          <Lista itens={plano.alternativas.map((a) => `${a.rotulo} · ${a.produto} · ${a.plataforma}`)} />
        </div>
      )}

      <p className="text-xs text-zinc-500">
        {ROTULO_MODO[plano.modo] ?? plano.modo} · modelo {plano.modelo} · {new Date(plano.gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
      </p>
    </div>
  );
}
