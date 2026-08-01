# Instruções para IA no Projeto Wayper

> **Status:** vigente<br>
> **Tipo:** fonte operacional detalhada<br>
> **Escopo:** agentes de IA e fluxos assistidos<br>
> **Última revisão:** 2026-08-01<br>
> **Fonte normativa relacionada:** [`docs/product/direcao-estrategica-completa.md`](product/direcao-estrategica-completa.md)

Este documento explica o processo detalhado de trabalho dos agentes. As regras
curtas e obrigatórias ficam em [`AGENTS.md`](../AGENTS.md); a hierarquia e a
matriz de leitura ficam em
[`docs/00-fontes-do-projeto.md`](00-fontes-do-projeto.md). Não copie a estratégia
ou regras técnicas completas para prompts paralelos.

## Fluxo antes da tarefa

1. Identifique o tipo, o domínio e a autorização da tarefa.
2. Carregue o núcleo permanente: `AGENTS.md`, o catálogo de fontes, a direção
   estratégica completa e `README.md`.
3. Consulte a matriz “tipo de tarefa → documentos” no catálogo.
4. Inspecione o código, os testes e a configuração reais do domínio.
5. Pesquise implementação semelhante, caminhos legados e dependências.
6. Consulte testes existentes, bugs conhecidos e evidências físicas aplicáveis.
7. Identifique divergências entre estado atual, decisões e planejamento.
8. Apresente ou registre um plano em fases pequenas, com risco, teste e rollback.
9. Execute somente a fase autorizada.

Uma tarefa documental segue o mesmo fluxo, mas não precisa carregar detalhes de
código alheios ao tema nem executar build do aplicativo sem motivo proporcional.

## Context Gate

Antes de escrever código ou documentação, registre internamente ou na resposta:

| Campo | Evidência mínima |
| --- | --- |
| Branch ativa | resultado de `git branch --show-current` |
| Estado do Git | resultado de `git status --short` e alterações locais relevantes |
| Núcleo lido | quatro fontes permanentes |
| Fontes específicas | documentos selecionados pela matriz |
| Implementação existente | arquivos, serviços, funções, componentes e caminhos legados encontrados |
| Testes existentes | suítes, scripts e checklists reais relacionados |
| Restrições | regras estratégicas e técnicas que limitam a fase |
| Divergências | estado atual versus direção, decisão, roadmap ou documento antigo |
| Escopo da fase | o que será e o que não será alterado |
| Testes planejados | comandos ou validações proporcionais ao risco |
| Rollback | como desfazer a fase sem perda de dados ou compatibilidade |

Se um campo não se aplicar, registre o motivo. O Context Gate impede começar a
escrever antes de compreender o projeto; ele não é uma formalidade para preencher
depois da alteração.

## Como interpretar as fontes

### Estado atual

Código, testes, configuração e comportamento observado em `develop` mostram o
que existe. `main` é referência estável. Afirmações de implementação exigem
evidência nessas fontes.

### Direção e decisões

A direção estratégica mostra como o produto deve evoluir. Decisões aprovadas e
ADRs aceitas definem contratos. Roadmap define sequência; backlog define ações
priorizadas. Hipóteses e propostas pendentes não autorizam implementação.

Nunca resuma essa relação como “o código sempre vence a documentação”. O código
pode revelar uma lacuna ou legado que precisa ser preservado até uma migração,
sem transformar o legado em direção aprovada.

## Planejamento e execução em fases

Cada fase deve ter:

- objetivo e critérios de aceite;
- arquivos previstos;
- dependências e compatibilidade;
- riscos de dados, corrida ativa, UX e operação;
- testes automatizados e manuais proporcionais;
- validações externas ou físicas pendentes;
- rollback;
- commit independente sugerido.

Não amplie a autorização. Uma tarefa de diagnóstico não autoriza correção; uma
tarefa documental não autoriza alteração de produção; uma feature pequena não
autoriza refatoração geral.

Durante a implementação:

- preserve alterações locais que não pertencem à tarefa;
- consolide a implementação existente em vez de abrir caminho paralelo;
- mantenha estado de domínio fora de componentes quando a regra exigir;
- preserve contratos locais, migração e rollback;
- interrompa e registre qualquer conflito estratégico não resolvido;
- atualize testes e fontes documentais afetadas pela mudança real.

## Protocolo de divergência

1. Descreva a divergência com arquivos e evidências.
2. Confirme o comportamento real.
3. Classifique cada fonte: estado atual, normativa, decisão, técnica,
   planejamento, operação, histórico ou hipótese.
4. Identifique qual fonte está desatualizada.
5. Preserve compatibilidade até existir migração segura.
6. Atualize ou marque a fonte incorreta sem apagar o histórico.
7. Registre decisão importante em ADR ou documento equivalente.
8. Informe impacto, risco, validação e rollback.

Quando duas decisões estratégicas forem incompatíveis, não escolha por
conveniência. Marque como `bloqueado`, exponha as alternativas e solicite decisão
humana.

## Regras contra alucinação e afirmações falsas

- Não invente arquivo, função, serviço, coleção, script ou configuração.
- Não invente teste, resultado, log, commit, build, deploy ou comportamento.
- Não assuma que documentação antiga ainda vale; verifique status e precedência.
- Não declare Android físico, GPS real, tela apagada ou background como validados
  sem execução real e evidência registrada.
- Não declare lint se o script ou a ferramenta não existir.
- Não afirme que SDK, gateway, provider, backend ou sync remoto está integrado
  sem evidência no código e na configuração.
- Não trate mock, demo, cache ou plano como dado real.
- Não transforme presença em roadmap ou documento futuro em implementação.
- Não esconda falha de comando, teste pulado ou validação pendente.

Separe explicitamente:

- **fato:** evidência observada em fonte real;
- **inferência:** conclusão derivada, com a base indicada;
- **hipótese:** possibilidade ainda não confirmada;
- **recomendação:** ação proposta, ainda não executada ou aprovada.

## Status documental

Use, quando aplicável: `aprovado`, `vigente`, `em revisão`,
`parcialmente implementado`, `planejado`, `hipótese`, `histórico`, `substituído`
ou `bloqueado`.

Status documental não substitui status de bug, execução ou validação física. Um
documento `vigente` pode descrever uma feature `parcialmente implementada`; um
checklist existente não significa que seus itens foram executados.

Também não confunda metadado documental com status de ideia. `Hipótese` pode ser
o tipo ou o status documental de uma fonte inteira; cada ideia dentro dela usa o
vocabulário operacional da direção estratégica, como `em validação` ou
`bloqueada`, sem adquirir autorização de implementação.

## Atualização documental por tipo de mudança

| Mudança | Fonte a atualizar |
| --- | --- |
| Decisão técnica | `docs/08-decisoes-tecnicas.md` ou `docs/architecture/adrs-direcao-oficial.md`; template em `docs/templates/template-decisao-tecnica.md` |
| Bug, risco ou regressão | `docs/13-bugs-conhecidos.md`; issue quando aplicável |
| Teste automatizado ou matriz manual | `docs/12-guia-de-testes.md`; checklist físico específico quando aplicável |
| Arquitetura ou fonte de estado | `docs/04-arquitetura.md`, modelo de dados e documento técnico do domínio |
| Regra de negócio | `docs/10-regras-de-negocio.md` e documento de produto relacionado |
| Roadmap ou gate | `docs/02-roadmap.md` |
| Prioridade ou ação executável | `docs/03-backlog.md` |
| Definição de produto ou experiência | `docs/01-visao-do-produto.md` e recorte correspondente em `docs/product/` |
| Build, release, ambiente ou rollback operacional | `docs/11-plano-de-deploy.md` e guia de testes |
| Hipótese ou ideia ainda não autorizada | `docs/product/11-hipoteses-em-avaliacao.md`, `docs/16-ideias-de-melhoria.md` ou `docs/17-propostas-pendentes.md`, conforme maturidade |
| Mudança estratégica | `docs/product/direcao-estrategica-completa.md`, decisões aprovadas, ADRs, roadmap, backlog e fontes temáticas afetadas |
| Entrega concluída | changelog e revisão de implementação, quando aplicáveis à fase |

Documento substituído deve manter aviso e link para a fonte sucessora. Auditoria
datada registra evidência histórica e não deve ser reescrita para parecer atual.

## Validação honesta

- Descubra scripts em `package.json`; não presuma nomes usuais.
- Execute a menor validação suficiente para o risco e amplie quando necessário.
- Para mudanças só em Markdown, prefira `git diff --check`, verificação de links,
  busca por caminhos absolutos e lint Markdown apenas se já configurado.
- Não instale dependência só para simular uma validação documental.
- Teste automatizado não substitui validação física de GPS/background.
- Registre comando, resultado, falha, item não executado e razão.

## Entrega por fase

Ao concluir, informe de forma verificável:

1. diagnóstico;
2. fontes consultadas;
3. arquivos analisados e alterados;
4. decisões e justificativas;
5. testes realmente executados e resultados;
6. divergências resolvidas e não resolvidas;
7. riscos e validações físicas pendentes;
8. rollback;
9. próximo passo;
10. commit sugerido.

Não faça commit, push, deploy, publicação ou alteração externa sem autorização
explícita da tarefa.
