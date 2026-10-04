/**
 * Diretor v1: monta o resumo dos dados, pede diagnóstico e recomendações à IA,
 * confere as regras de prudência e grava relatório + recomendações (status "proposta").
 * Nesta versão o Diretor NÃO executa nada: só propõe, e um humano aprova ou recusa.
 */

import { lerPresenca, resumoDaPresenca } from "@/lib/presenca/painel";
import type { createAdminClient } from "@/lib/supabase/admin";
import { ErroIA, iaConfigurada, pedirJson } from "./claude";
import { aplicarRegras } from "./regras";
import { carregarResumo } from "./resumo";
import { respostaDiretorSchema, type ResumoDiretor } from "./tipos";

type Admin = ReturnType<typeof createAdminClient>;

export const SISTEMA_DIRETOR = `Você é a JUDITE, Diretora de Marketing (CMO) com IA de uma pequena empresa brasileira.
Todo dia você recebe um resumo em JSON com os dados reais do negócio (anúncios, site, vendas registradas, metas e limites) e escreve um diagnóstico e recomendações para o dono, que é leigo em marketing.

Regras que você nunca quebra:
1. Use SOMENTE os números que estão no JSON. Nunca invente, estime ou arredonde para cima preços, vendas, avaliações, prazos ou resultados. Se um dado não está no JSON, diga que falta o dado.
2. Leia o campo "avisos": ele diz o que está faltando. Com poucos dados, a recomendação certa é coletar dados (conectar plataforma, registrar vendas, instalar o rastreador), não mexer em verba.
3. Só recomende pausar campanha ou mudar orçamento quando a campanha tiver pelo menos regras.dias_minimos_de_dados dias de dados e regras.cliques_minimos cliques na janela. Para AUMENTAR verba, exija também regras.conversoes_minimas_para_aumentar conversões. Respeite o período de aprendizado das plataformas e não reaja a oscilações pequenas.
4. Em recomendações de verba, preencha "plataforma" e "campanha_id" exatamente como aparecem em "campanhas". Em "ajustar_orcamento", "valor_sugerido" é o novo orçamento diário em reais, variando no máximo limites.aumento_max_por_ajuste_percent por cento em relação ao atual, e sem fazer o gasto do mês passar de limites.orcamento_mensal_max. Nos outros tipos, deixe plataforma, campanha_id e valor_sugerido como null.
5. Previsões são probabilísticas: escreva "tende a", "é provável", nunca prometa resultado. Em "impacto_esperado" descreva o efeito esperado em palavras, sem inventar percentuais.
6. Você apenas recomenda. Nada é executado sem a aprovação de um humano.
7. Quando o JSON trouxer "presenca_google", use-o para sugerir melhorias do Perfil da Empresa no Google (tipo "perfil_google": itens faltando no perfil, avaliações sem resposta) e do site na busca (tipo "seo": consultas com muitas impressões e poucos cliques, páginas em posição média entre 5 e 20, perguntas que as pessoas fazem e o site não responde, pensando também em respostas de IA/AEO). Nunca escreva o texto de uma resposta a avaliação nem de um post como se fosse publicar: apenas recomende, pois publicar exige aprovação do dono.

Como escrever:
- Português do Brasil simples, direto, sem jargão. Quando usar um termo técnico (ROAS, CAC, CTR), explique em poucas palavras.
- "diagnostico": 2 a 4 parágrafos curtos sobre como o marketing está hoje, começando pelo mais importante.
- "pontos": de 2 a 6 observações, cada uma com o número que a sustenta.
- "recomendacoes": no máximo 6, da mais importante para a menos. Cada justificativa cita os números do JSON em que se apoia. Se não houver nada seguro a recomendar, devolva poucas recomendações (ou nenhuma) em vez de forçar.`;

export type ResultadoGeracao =
  | { ok: true; relatorioId: string; recomendacoes: number; descartadas: number }
  | { ok: false; motivo: string };

/**
 * Blocos extras do resumo, vindos de outros módulos. Um módulo com problema (ex.: Google fora do ar,
 * tabela ainda não criada) nunca impede o relatório do dia: o bloco só fica de fora, com um aviso.
 */
async function acrescentarExtras(db: Admin, workspaceId: string, resumo: ResumoDiretor): Promise<void> {
  try {
    const presenca = await lerPresenca(db, workspaceId);
    if (presenca.ok) resumo.presenca_google = resumoDaPresenca(presenca.presenca);
    else resumo.avisos.push("Presença no Google (Perfil da Empresa e Search Console) não conectada: " + presenca.motivo);
  } catch {
    resumo.avisos.push("Não foi possível ler a Presença no Google agora.");
  }
}

export async function gerarRelatorio(db: Admin, workspaceId: string, origem: "cron" | "manual", usuarioId: string | null): Promise<ResultadoGeracao> {
  if (!iaConfigurada()) return { ok: false, motivo: "Falta a variável ANTHROPIC_API_KEY no servidor." };

  const resumo = await carregarResumo(db, workspaceId);
  await acrescentarExtras(db, workspaceId, resumo);

  try {
    const resposta = await pedirJson({
      schema: respostaDiretorSchema,
      sistema: SISTEMA_DIRETOR,
      usuario: "Resumo dos dados de hoje (JSON):\n" + JSON.stringify(resumo),
    });
    const validada = respostaDiretorSchema.safeParse(resposta.dados);
    if (!validada.success) throw new ErroIA("A IA respondeu fora do formato esperado.");
    const { aceitas, descartadas } = aplicarRegras(validada.data.recomendacoes.slice(0, 10), resumo);

    const { data: relatorio, error } = await db.from("diretor_relatorios").insert({
      workspace_id: workspaceId,
      dia: resumo.hoje,
      origem,
      criado_por: usuarioId,
      modelo: resposta.modelo,
      status: "ok",
      resumo,
      diagnostico: validada.data.diagnostico.slice(0, 6000),
      pontos: validada.data.pontos.slice(0, 8).map((p) => ({ tipo: p.tipo, titulo: p.titulo.slice(0, 200), detalhe: p.detalhe.slice(0, 1000) })),
      descartadas,
      tokens_entrada: resposta.tokensEntrada,
      tokens_saida: resposta.tokensSaida,
    }).select("id").single();
    if (error || !relatorio) return { ok: false, motivo: "Não foi possível gravar o relatório: " + (error?.message ?? "erro desconhecido") };

    if (aceitas.length) {
      const { error: erroRec } = await db.from("diretor_recomendacoes").insert(aceitas.map((r, i) => ({
        workspace_id: workspaceId,
        relatorio_id: relatorio.id,
        ordem: i,
        tipo: r.tipo,
        titulo: r.titulo.slice(0, 200),
        justificativa: r.justificativa.slice(0, 2000),
        impacto_esperado: r.impacto_esperado.slice(0, 1000) || null,
        prioridade: r.prioridade,
        plataforma: r.plataforma,
        campanha_id: r.campanha_id,
        valor_sugerido: r.valor_sugerido,
        status: "proposta",
      })));
      if (erroRec) return { ok: false, motivo: "Relatório gravado, mas as recomendações falharam: " + erroRec.message };
    }
    return { ok: true, relatorioId: relatorio.id as string, recomendacoes: aceitas.length, descartadas: descartadas.length };
  } catch (erro) {
    const motivo = erro instanceof ErroIA ? erro.message : "Erro inesperado ao gerar o relatório.";
    // Registra a tentativa que falhou, para a tela mostrar o que aconteceu.
    await db.from("diretor_relatorios").insert({
      workspace_id: workspaceId, dia: resumo.hoje, origem, criado_por: usuarioId, status: "erro", erro: motivo.slice(0, 500), resumo,
    });
    return { ok: false, motivo };
  }
}
