/**
 * O Diretor monta um rascunho de campanha com a IA, a partir do resumo real do workspace,
 * de um produto cadastrado e dos criativos salvos. O resultado passa por rascunhoSchema e
 * por conferirRascunho antes de ser gravado, e SEMPRE nasce aguardando aprovação.
 */

import { pedirJson } from "@/lib/ia";
import type { ResumoDiretor } from "@/lib/diretor/tipos";
import { rascunhoIaSchema, rascunhoSchema, type Rascunho } from "./rascunho";

const SISTEMA = `Você é a JUDITE, Diretora de Marketing (CMO) com IA de uma pequena empresa brasileira, e vai propor UMA campanha de anúncios nova.

Regras que você nunca quebra:
1. Use SOMENTE os dados do JSON (resumo do negócio, produto, criativos disponíveis, limites). Não invente preço, público comprovado, resultado esperado em números nem fatos sobre o produto.
2. "plataforma" precisa ser uma das plataformas_permitidas. Prefira uma que já esteja conectada.
3. "orcamento_diario" em reais: no máximo limites.orcamento_diario_max_sem_aprovacao, e pequeno o bastante para o gasto do mês (limites.gasto_no_mes + orçamento × limites.dias_restantes_no_mes) não passar de limites.orcamento_mensal_max. Comece conservador: campanha nova passa por período de aprendizado.
4. "criativo_ids": escolha de 1 a 3 ids da lista criativos_disponiveis (copie o id exatamente). Se a lista estiver vazia, devolva uma lista vazia.
5. "publico": região, faixa de idade (entre 18 e 65, ou null) e interesses coerentes com o campo "publico" do produto. Se não houver informação, deixe genérico e diga isso na justificativa.
6. "nome": curto e descritivo, começando por "JUDITE - ".
7. "justificativa": 2 a 4 frases em português simples explicando por que essa campanha, citando os números do JSON em que se apoiou. Diga que a campanha será criada pausada e depende de aprovação.`;

export async function montarRascunhoComIA(opcoes: {
  resumo: ResumoDiretor;
  produto: { id: string; nome: string; descricao: string | null; preco: number | null; detalhes: string | null; publico: string | null };
  criativos: { id: string; plataforma: string | null; formato: string; titulo: string; descricao: string | null }[];
  plataformasPermitidas: string[];
  orientacao: string | null;
}): Promise<Rascunho> {
  const resposta = await pedirJson({
    schema: rascunhoIaSchema,
    sistema: SISTEMA,
    usuario: "Monte o rascunho da campanha para este pedido (JSON):\n" + JSON.stringify({
      resumo_do_negocio: opcoes.resumo,
      produto: opcoes.produto,
      criativos_disponiveis: opcoes.criativos,
      plataformas_permitidas: opcoes.plataformasPermitidas,
      orientacao_do_dono: opcoes.orientacao,
    }),
    maxTokens: 8000,
  });
  const ia = rascunhoIaSchema.parse(resposta.dados);
  const idade = (n: number | null) => (n === null ? null : Math.min(65, Math.max(18, Math.round(n))));
  const validos = new Set(opcoes.criativos.map((c) => c.id));
  // Tudo o que a IA devolve passa pelo mesmo schema do rascunho digitado por uma pessoa.
  return rascunhoSchema.parse({
    plataforma: ia.plataforma,
    nome: ia.nome.trim().slice(0, 150),
    objetivo: ia.objetivo,
    orcamento_diario: Math.round(ia.orcamento_diario * 100) / 100,
    publico: {
      regiao: ia.publico.regiao.slice(0, 200), idade_min: idade(ia.publico.idade_min), idade_max: idade(ia.publico.idade_max),
      interesses: ia.publico.interesses.slice(0, 500),
    },
    produto_id: opcoes.produto.id,
    // Id que a IA inventou (não está na lista) é simplesmente descartado.
    criativo_ids: ia.criativo_ids.filter((id) => validos.has(id)).slice(0, 6),
    justificativa: ia.justificativa.trim().slice(0, 2000),
  });
}
