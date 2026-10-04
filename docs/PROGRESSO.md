# Progresso do modo autônomo

Diário do Claude Code. Cada etapa concluída ganha uma entrada: data/hora, o que foi feito,
arquivos principais, decisões tomadas sozinho e o que o Jackson precisa testar.

## Entradas

### Etapa 1 — Diagnóstico da aba Site (04/10/2026, madrugada)

**O que descobri**
- O site www.guialencois.org carrega o rastreador certo (`<script defer src="https://judite-pi.vercel.app/j.js" data-chave="9665d30b…">`) e **não tem** cabeçalho de segurança (CSP) que bloqueie o script.
- O `j.js` publicado responde 200 com o tipo correto; a rota `/api/coleta` responde.
- Consultei o banco **só para leitura** (um `select` em `sites` e `site_eventos`): o site está cadastrado com a mesma chave e **já existem 8 eventos gravados**, o primeiro às 23h57 de 03/10 (horário de Brasília), todos de Barreirinhas (7 visualizações e 1 clique no WhatsApp).
- Conclusão: o "0 visitas" era de antes da publicação das 23h57 (a versão do `j.js` no ar tem exatamente esse horário). **A coleta está funcionando.** Não encontrei erro de CORS, de origem (aceita `guialencois.org` e `www.guialencois.org`) nem do proxy.

**O que mudei**
- `public/j.js`: modo de teste. Abrir `https://www.guialencois.org/?judite_teste=1` envia um evento marcado como teste e mostra uma faixa verde/vermelha no canto do site com o resultado e o motivo.
- `src/app/api/coleta/route.ts`: no modo de teste a rota responde o motivo (robô, chave errada, domínio errado, banco recusou). Fora do teste continua respondendo 204 sem explicar nada. Erro de gravação agora aparece nos logs da Vercel (antes sumia em silêncio). Cidade com codificação quebrada não derruba mais a coleta. `/index.html` passa a contar como `/`.
- Aba Site: indicador **"Última visita recebida"** e **"Último teste"**, sempre visíveis.
- Vitest instalado (`npx vitest run`), com os primeiros testes em `src/lib/site/resumo.test.ts`.

**Decisões tomadas sozinho**
- O teste é gravado como `tipo = evento` e `nome = judite_teste`, sem coluna nova: assim **não precisa de migração** e funciona já. Esses eventos ficam fora de todas as contas.
- Mantive o filtro de robôs como estava (não afrouxei).
- Para instalar o Vitest precisei subir `@types/node` de 20 para 22 (só tipos; não muda o site).
- Li o banco de produção apenas com `select`. Nada foi escrito nem aplicado.

**Como testar**
1. Abra `https://www.guialencois.org/?judite_teste=1` (depois que a prévia/produção estiver com este código). Deve aparecer a faixa verde "teste recebido".
2. Na JUDITE, aba Site: "Última visita recebida" e "Último teste" com data e hora.
