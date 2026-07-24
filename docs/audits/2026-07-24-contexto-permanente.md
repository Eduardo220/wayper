# Fase B — contexto permanente

**Data:** 2026-07-24  
**Branch:** `develop`  
**Base:** Fase A no commit `9b9d467`  
**Escopo:** documentação e governança; sem código de produção

## Diagnóstico

A arquitetura local-first estava mais avançada que a narrativa do produto.
README, visão, roadmap e documentos históricos ainda colocavam mapa/captura no
centro da corrida. `develop` também não possuía `AGENTS.md`, e documentos antigos
atribuíam precedência canônica a `docs/wayper`.

## Mudanças

- criada regra permanente em `AGENTS.md`;
- criada a coleção normativa `docs/product/`;
- registrados ADR-028 a ADR-038;
- documentados portabilidade, providers e estratégia planejada de flags;
- reconciliados README, fontes, visão, roadmap, backlog, arquitetura, dados,
  fluxos, padrões, design, negócio, deploy, testes e instruções para IA;
- marcados documentos antigos de MVP/visão como históricos onde necessário;
- registrada a divergência entre território individual documentado e captura
  competitiva implementada;
- corrigido o estado da ideia de fila pós-finalização, que já está implementada;
- definidos eventos de analytics sem instrumentá-los.

## Justificativa

Novas features precisam distinguir:

- regra aprovada que pode orientar implementação;
- conceito que somente orienta arquitetura;
- hipótese sem autorização de produção;
- comportamento realmente implementado.

Essa distinção impede antecipar anúncios, gateway, planos, parceiros, moedas ou
schemas e protege o tracking de acoplamentos comerciais.

## Arquivos analisados

Todos os grupos registrados na auditoria da Fase A, com nova revisão dirigida dos
documentos operacionais e históricos alterados nesta fase.

## Arquivos alterados

- `AGENTS.md` e `README.md`;
- `docs/00` a `docs/20`, nos documentos afetados;
- `docs/24-resumo-rodada-local-first.md`;
- `docs/product/`;
- `docs/architecture/`;
- documentos de visão, MVP, território, corrida, telas, decisões, prompts e
  glossário em `docs/wayper/`;
- este relatório.

Nenhum arquivo em `src/`, dependência, configuração de build, schema local ou
schema remoto foi alterado.

## Testes executados

1. `git diff --check`
   - resultado: passou, sem erro de whitespace;
   - observação: Git reportou avisos já esperados de normalização CRLF/LF em
     documentos históricos.
2. validação de links Markdown locais em `AGENTS.md`, README,
   `docs/product/` e `docs/architecture/`
   - resultado: 21 arquivos verificados, nenhum alvo ausente.
3. `npm test -- --runInBand`
   - resultado: 51 suites, 458 testes, todos passaram;
   - snapshots: zero;
   - tempo informado pelo Jest: 18,19 s;
   - aviso não bloqueante: `console.warn` esperado no teste de feed offline.

## Riscos restantes

- documentação não muda a UI ativa ainda centrada no mapa;
- `MapScreen` continua orquestrando a finalização;
- não há contrato implementado de Expedição/Relatório;
- regra territorial competitiva continua pendente;
- flags, entitlements, parceiros, ads e pagamentos são somente planejados;
- serviços legados continuam presentes e não devem ser removidos sem migração.

## Validações físicas pendentes

Nenhuma validação Android física foi executada nesta fase. Permanecem pendentes:

- tela apagada/bloqueada e background;
- restrições de bateria;
- reabertura por ícone/notificação;
- pausa/retomada;
- GPS oscilante;
- finalização offline, concorrente e após kill/recriação;
- dev client e build release/preview.

## Próximos passos

Fase C: executar a matriz física de segurança sem mudar gamificação. Somente
falhas comprovadas devem gerar correções. Depois, Fase D extrai a finalização e
evolui a fila existente para o pipeline da Expedição.

## Commit sugerido

`docs(product): consolidar direção oficial e regras permanentes`
