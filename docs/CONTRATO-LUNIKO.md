# Contrato JUDITE → LUNIKO (versão 1)

> **Zero fusão.** A JUDITE decide ("quero criar esta campanha"); o LUNIKO executa workflows.
> Os dois projetos têm repositórios e bancos separados e só conversam por este contrato.
> A JUDITE não lê tabelas do LUNIKO, e o LUNIKO não lê tabelas da JUDITE.

## Situação

- Implementado na JUDITE: o envio de eventos (`src/lib/luniko/eventos.ts`), **desligado por padrão**.
- Só liga quando as duas variáveis existem no servidor da JUDITE: `LUNIKO_WEBHOOK_URL` e `LUNIKO_WEBHOOK_SECRET`.
- Ainda não implementado: o caminho de volta (LUNIKO → JUDITE). Veja "Próximo passo".

## Envio

`POST` para `LUNIKO_WEBHOOK_URL`, corpo JSON, tempo limite de 5 segundos. Uma falha no envio **não** desfaz a ação
na JUDITE: o evento continua registrado no histórico dela (`campanha_eventos`).

| Cabeçalho | Conteúdo |
|---|---|
| `x-judite-evento` | ID único do evento (UUID). Use para não processar duas vezes (idempotência). |
| `x-judite-timestamp` | Segundos desde 1970 (UTC) no momento do envio. Recuse eventos com mais de 5 minutos. |
| `x-judite-assinatura` | HMAC-SHA256, em hexadecimal, de `<timestamp>.<corpo>` com o segredo compartilhado. |

Para conferir a assinatura no LUNIKO: refaça o HMAC com o corpo **exatamente como chegou** (bytes) e compare em tempo constante.

## Envelope

```json
{
  "id": "uuid do evento",
  "tipo": "campanha.estado_mudou",
  "versao": "1",
  "emitido_em": "2026-10-05T09:30:00.000Z",
  "dados": { }
}
```

## Evento `campanha.estado_mudou`

Emitido a cada mudança de estado de uma campanha da JUDITE (inclusive quando a proposta entra na fila).

| Campo de `dados` | Tipo | Descrição |
|---|---|---|
| `workspace_id` | uuid | Empresa dona da campanha. |
| `campanha_id` | uuid | ID da campanha na JUDITE (`campanha_rascunhos.id`). |
| `de` | texto ou null | Estado anterior (null quando a proposta acabou de ser criada). |
| `para` | texto | Estado novo. |
| `ator` | `pessoa`, `ia` ou `sistema` | Quem causou a mudança. |
| `motivo` | texto | Explicação curta, em português. |

Estados: `rascunho`, `aguardando_aprovacao`, `publicada_pausada`, `ativa`, `aprendizado`, `otimizando`, `pausada`,
`pausada_pela_ia`, `concluida`, `recusada`, `erro`. As transições válidas estão em `src/lib/cmo/estados.ts`.

O evento **não** carrega tokens, chaves nem dados de clientes.

## Regras

1. Mudança incompatível no formato = `versao` nova. Campos novos opcionais não mudam a versão.
2. O LUNIKO responde `2xx` quando aceitou o evento. Qualquer outra resposta é tratada como falha de entrega (sem nova tentativa hoje).
3. Dinheiro: nenhum evento autoriza o LUNIKO a gastar. Criar, ativar e mudar verba continuam passando pelos freios da JUDITE.

## Próximo passo

Para o LUNIKO executar a criação de campanhas no lugar da JUDITE: (a) fila de reenvio na JUDITE para entregas que falharam;
(b) rota assinada na JUDITE para o LUNIKO devolver o resultado da execução (`execucao.concluida` / `execucao.falhou`);
(c) um provedor "LUNIKO" implementando `ProvedorAnuncios` (`src/lib/anuncios/provedor.ts`), para as telas e os freios não mudarem.
