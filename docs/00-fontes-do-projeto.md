# Fontes do Projeto Wayper

> **Status:** vigente<br>
> **Tipo:** fonte operacional e índice canônico<br>
> **Escopo:** todo o repositório<br>
> **Última revisão:** 2026-08-01<br>
> **Fonte normativa relacionada:** [`docs/product/direcao-estrategica-completa.md`](product/direcao-estrategica-completa.md)

## Finalidade

Este arquivo registra quais fontes existem, o papel e a autoridade de cada uma,
o núcleo que deve ser lido em toda tarefa, as leituras específicas por domínio e
o protocolo para resolver conflitos. Ele é o catálogo central da documentação;
não transforma todos os documentos em fontes igualmente autoritativas.

## Núcleo permanente

Toda tarefa começa por:

1. [`AGENTS.md`](../AGENTS.md): regras operacionais curtas e obrigatórias;
2. [`docs/00-fontes-do-projeto.md`](00-fontes-do-projeto.md): hierarquia,
   catálogo e roteamento de leitura;
3. [`docs/product/direcao-estrategica-completa.md`](product/direcao-estrategica-completa.md):
   direção normativa e restrições permanentes;
4. [`README.md`](../README.md): entrada humana, visão resumida, stack e estado
   geral.

Depois do núcleo, leia somente as fontes relacionadas à tarefa. O processo
detalhado dos agentes está em
[`docs/14-instrucoes-para-ia.md`](14-instrucoes-para-ia.md).

## Dois tipos de verdade

### Verdade sobre o estado atual

Use esta ordem para descobrir o que existe e como funciona hoje:

1. código atual da branch `develop`;
2. testes atuais;
3. configuração atual, inclusive `package.json`, arquivos de ambiente de
   exemplo e configuração de plataforma;
4. comportamento observável com evidência;
5. branch `main`, somente como referência estável.

O código atual descreve comportamento, não aprovação estratégica. Código legado,
incompleto ou incorreto não se torna uma decisão vigente por existir.

### Verdade sobre direção e decisões

Use esta ordem para decidir como o projeto deve evoluir:

1. [`docs/product/direcao-estrategica-completa.md`](product/direcao-estrategica-completa.md);
2. decisões aprovadas em
   [`docs/product/10-decisoes-aprovadas.md`](product/10-decisoes-aprovadas.md);
3. ADRs aceitas em
   [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md)
   e [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md);
4. princípios e regras de negócio vigentes;
5. roadmap aprovado;
6. backlog priorizado.

A direção estratégica define restrições permanentes e o futuro desejado. ADRs
registram decisões técnicas aceitas. Roadmap e backlog ordenam execução.
Documentação temática explica domínios. Hipóteses, ideias e propostas pendentes
não autorizam código de produção.

## Hierarquia por finalidade

### Estado atual

- `develop`, testes, configuração e comportamento observado são fontes
  primárias do implementado.
- `main` é referência estável, não substituto de `develop` nem da direção.
- [`docs/04-arquitetura.md`](04-arquitetura.md),
  [`docs/05-modelo-de-dados.md`](05-modelo-de-dados.md) e documentos técnicos
  descrevem o estado conhecido, sempre sujeito à confirmação no código.

### Direção estratégica

- A fonte normativa principal é
  [`docs/product/direcao-estrategica-completa.md`](product/direcao-estrategica-completa.md).
- Os arquivos numerados em [`docs/product/`](product/README.md) são recortes
  temáticos complementares.
- Decisões aprovadas e ADRs vinculam evolução técnica e de produto dentro do
  próprio escopo.

### Planejamento

- [`docs/02-roadmap.md`](02-roadmap.md) define ordem e gates de evolução.
- [`docs/03-backlog.md`](03-backlog.md) registra trabalho priorizado.
- [`docs/17-propostas-pendentes.md`](17-propostas-pendentes.md),
  [`docs/20-backlog-ia.md`](20-backlog-ia.md), issues e pull requests não
  substituem aprovação nem prioridade oficial.
- Planos de implementação são operacionais e subordinados à estratégia, ao
  roadmap e ao estado real.

### Operação e validação

- [`docs/12-guia-de-testes.md`](12-guia-de-testes.md) define validação geral.
- [`docs/11-plano-de-deploy.md`](11-plano-de-deploy.md) orienta build e deploy.
- [`docs/diagnostics.md`](diagnostics.md) é a fonte técnica de diagnóstico e
  Sentry.
- [`docs/13-bugs-conhecidos.md`](13-bugs-conhecidos.md) é o registro vigente de
  bugs e riscos.
- [`docs/22-teste-real-corrida-background.md`](22-teste-real-corrida-background.md)
  e [`docs/wayper/15-checklist-validacao-corrida-ativa.md`](wayper/15-checklist-validacao-corrida-ativa.md)
  são checklists físicos; não provam execução por si mesmos.

### Histórico e referência

- [`docs/audits/`](audits/) contém snapshots e evidências datadas.
- [`docs/18-changelog-produto.md`](18-changelog-produto.md) e
  [`docs/19-revisoes-de-implementacao.md`](19-revisoes-de-implementacao.md)
  preservam histórico de entregas e revisões.
- [`docs/24-resumo-rodada-local-first.md`](24-resumo-rodada-local-first.md) é um
  snapshot técnico, não a direção vigente.
- [`docs/wayper/`](wayper/00-index.md) reúne detalhamento técnico e material
  histórico. Quando divergir, consulte a fonte principal indicada neste
  catálogo e registre a lacuna.

## Catálogo dos documentos

O status abaixo indica a situação da fonte ou a maturidade declarada do domínio.
Quando direção e execução diferem, a célula declara ambas como
`direção: ...; execução: ...`. Assim, aprovação conceitual de uma arquitetura não
é confundida com autorização para integrar provider, SDK, schema ou fluxo de
produção. Em todos os casos, confirme implementação no código, nos testes e no
próprio documento.

| Domínio | Fonte principal | Fontes complementares | Tipo | Status |
| --- | --- | --- | --- | --- |
| Produto | [`docs/01-visao-do-produto.md`](01-visao-do-produto.md) | [`docs/product/00-visao-oficial.md`](product/00-visao-oficial.md), [`docs/product/01-principios-do-produto.md`](product/01-principios-do-produto.md) | Fonte normativa sintética | Vigente |
| Direção estratégica | [`docs/product/direcao-estrategica-completa.md`](product/direcao-estrategica-completa.md) | [`docs/product/README.md`](product/README.md), [`docs/product/10-decisoes-aprovadas.md`](product/10-decisoes-aprovadas.md) | Fonte normativa | Aprovado |
| Arquitetura | [`docs/04-arquitetura.md`](04-arquitetura.md) | [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md), [`docs/05-modelo-de-dados.md`](05-modelo-de-dados.md), [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md), [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md) | Fonte técnica de estado e direção | Vigente |
| Tracking | [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md) | [`docs/wayper/04-regras-corrida.md`](wayper/04-regras-corrida.md), [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md) | Fonte técnica complementar | Vigente |
| Background | [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md) | [`docs/22-teste-real-corrida-background.md`](22-teste-real-corrida-background.md), [`docs/wayper/15-checklist-validacao-corrida-ativa.md`](wayper/15-checklist-validacao-corrida-ativa.md), [`docs/13-bugs-conhecidos.md`](13-bugs-conhecidos.md) | Técnica e validação | Em revisão |
| Foreground | [`docs/product/07-experiencia-durante-a-corrida.md`](product/07-experiencia-durante-a-corrida.md) | [`docs/23-onboarding-permissoes-estados-vazios.md`](23-onboarding-permissoes-estados-vazios.md), [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md) | Regra de produto e técnica | Vigente |
| Localização | [`docs/wayper/05-gps-e-validacao.md`](wayper/05-gps-e-validacao.md) | [`docs/23-onboarding-permissoes-estados-vazios.md`](23-onboarding-permissoes-estados-vazios.md), [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md) | Fonte técnica | Vigente |
| GPS e distância | [`docs/wayper/05-gps-e-validacao.md`](wayper/05-gps-e-validacao.md) | [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md), ADR-010 e ADR-027 em [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md), [`docs/05-modelo-de-dados.md`](05-modelo-de-dados.md), [`docs/12-guia-de-testes.md`](12-guia-de-testes.md) | Fonte técnica | Vigente |
| Persistência | [`docs/05-modelo-de-dados.md`](05-modelo-de-dados.md) | [`docs/04-arquitetura.md`](04-arquitetura.md), [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md), [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md) | Estado técnico | Vigente |
| Modo offline | [`docs/04-arquitetura.md`](04-arquitetura.md) | [`docs/wayper/04-regras-corrida.md`](wayper/04-regras-corrida.md), [`docs/24-resumo-rodada-local-first.md`](24-resumo-rodada-local-first.md), ADR-029 em [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md) | Técnica; snapshot como complemento | Vigente |
| Recuperação | [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md) | [`docs/wayper/04-regras-corrida.md`](wayper/04-regras-corrida.md), ADR-007/008/027/028 em [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md), [`docs/12-guia-de-testes.md`](12-guia-de-testes.md), [`docs/13-bugs-conhecidos.md`](13-bugs-conhecidos.md) | Fonte técnica | Vigente |
| Notificação | [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md) | ADR-009 em [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md), [`docs/22-teste-real-corrida-background.md`](22-teste-real-corrida-background.md), [`docs/wayper/15-checklist-validacao-corrida-ativa.md`](wayper/15-checklist-validacao-corrida-ativa.md) | Técnica e validação | Em revisão |
| Finalização | [`docs/04-arquitetura.md`](04-arquitetura.md) | [`docs/06-fluxos-de-usuario.md`](06-fluxos-de-usuario.md), ADR-030 em [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md), ADR-026/028 em [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md), [`docs/12-guia-de-testes.md`](12-guia-de-testes.md), [`docs/13-bugs-conhecidos.md`](13-bugs-conhecidos.md) | Técnica e decisão | Vigente |
| Diagnóstico | [`docs/diagnostics.md`](diagnostics.md) | ADR-021/023 em [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md), [`docs/12-guia-de-testes.md`](12-guia-de-testes.md) | Fonte técnica e operacional | Vigente |
| Sentry | [`docs/diagnostics.md`](diagnostics.md) | [`docs/11-plano-de-deploy.md`](11-plano-de-deploy.md), ADR-016/025 em [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md), [`docs/13-bugs-conhecidos.md`](13-bugs-conhecidos.md) | Técnica e operação | Em revisão |
| Territórios | [`docs/15-corrida-por-zonas.md`](15-corrida-por-zonas.md) | [`docs/wayper/03-mecanica-territorios.md`](wayper/03-mecanica-territorios.md), [`docs/05-modelo-de-dados.md`](05-modelo-de-dados.md), [`docs/10-regras-de-negocio.md`](10-regras-de-negocio.md) | Técnica; regra competitiva pendente | Em revisão |
| Ranking | [`docs/wayper/06-xp-nivel-ranking.md`](wayper/06-xp-nivel-ranking.md) | [`docs/10-regras-de-negocio.md`](10-regras-de-negocio.md), [`docs/05-modelo-de-dados.md`](05-modelo-de-dados.md), [`docs/product/08-relatorio-da-expedicao.md`](product/08-relatorio-da-expedicao.md) | Técnica e regra de negócio | Vigente |
| Progressão | [`docs/product/09-economia-e-recompensas.md`](product/09-economia-e-recompensas.md) | [`docs/wayper/06-xp-nivel-ranking.md`](wayper/06-xp-nivel-ranking.md), [`docs/10-regras-de-negocio.md`](10-regras-de-negocio.md), [`docs/04-arquitetura.md`](04-arquitetura.md) | Direção e estado técnico | Parcialmente implementado |
| Pós-corrida | [`docs/product/08-relatorio-da-expedicao.md`](product/08-relatorio-da-expedicao.md) | [`docs/06-fluxos-de-usuario.md`](06-fluxos-de-usuario.md), [`docs/04-arquitetura.md`](04-arquitetura.md), [`docs/05-modelo-de-dados.md`](05-modelo-de-dados.md) | Fonte normativa temática | Aprovado |
| Replay | [`docs/product/08-relatorio-da-expedicao.md`](product/08-relatorio-da-expedicao.md) | [`docs/06-fluxos-de-usuario.md`](06-fluxos-de-usuario.md), [`docs/wayper/05-gps-e-validacao.md`](wayper/05-gps-e-validacao.md), [`docs/audits/`](audits/) | Direção temática; sem fonte exclusiva | Em revisão |
| Compartilhamento | [`docs/wayper/07-telas-e-fluxos.md`](wayper/07-telas-e-fluxos.md) | [`docs/share-debug.md`](share-debug.md), ADR-020 em [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md), [`docs/12-guia-de-testes.md`](12-guia-de-testes.md) | Técnica e validação | Vigente |
| Monetização | [`docs/product/02-modelo-de-negocio.md`](product/02-modelo-de-negocio.md) | [`docs/product/03-planos-e-entitlements.md`](product/03-planos-e-entitlements.md), [`docs/product/05-monetizacao-e-anuncios.md`](product/05-monetizacao-e-anuncios.md) | Fonte normativa temática | Direção: aprovado; execução: planejada |
| Anúncios | [`docs/product/05-monetizacao-e-anuncios.md`](product/05-monetizacao-e-anuncios.md) | ADR-032/038 em [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md), [`docs/product/11-hipoteses-em-avaliacao.md`](product/11-hipoteses-em-avaliacao.md) | Política normativa e hipóteses de placement/provider | Direção: aprovada conceitualmente; integração: bloqueada |
| Planos e entitlements | [`docs/product/03-planos-e-entitlements.md`](product/03-planos-e-entitlements.md) | [`docs/product/02-modelo-de-negocio.md`](product/02-modelo-de-negocio.md), ADR-033 em [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md), [`docs/architecture/feature-flags.md`](architecture/feature-flags.md) | Fonte normativa temática | Plus: aprovado conceitualmente; execução: planejada; Pro: hipótese em validação |
| Parceiros | [`docs/product/04-parcerias-e-patrocinios.md`](product/04-parcerias-e-patrocinios.md) | [`docs/product/02-modelo-de-negocio.md`](product/02-modelo-de-negocio.md), [`docs/product/09-economia-e-recompensas.md`](product/09-economia-e-recompensas.md), ADR-034 em [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md) | Fonte normativa temática | Direção: aprovada conceitualmente; execução: planejada |
| Pagamentos | [`docs/product/direcao-estrategica-completa.md`](product/direcao-estrategica-completa.md) | [`docs/product/02-modelo-de-negocio.md`](product/02-modelo-de-negocio.md), ADR-035 em [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md), [`docs/product/11-hipoteses-em-avaliacao.md`](product/11-hipoteses-em-avaliacao.md) | Direção e decisão conceitual; sem contrato implementado | Arquitetura de gateway: aprovada conceitualmente; integração: bloqueada |
| Feature flags | [`docs/architecture/feature-flags.md`](architecture/feature-flags.md) | ADR-036 em [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md), [`docs/04-arquitetura.md`](04-arquitetura.md) | Fonte técnica | Parcialmente implementado |
| Testes | [`docs/12-guia-de-testes.md`](12-guia-de-testes.md) | [`docs/22-teste-real-corrida-background.md`](22-teste-real-corrida-background.md), [`docs/wayper/15-checklist-validacao-corrida-ativa.md`](wayper/15-checklist-validacao-corrida-ativa.md), [`docs/13-bugs-conhecidos.md`](13-bugs-conhecidos.md) | Fonte operacional | Vigente |
| Deploy | [`docs/11-plano-de-deploy.md`](11-plano-de-deploy.md) | `package.json`, [`docs/12-guia-de-testes.md`](12-guia-de-testes.md), [`docs/diagnostics.md`](diagnostics.md) | Fonte operacional | Em revisão |
| Bugs conhecidos | [`docs/13-bugs-conhecidos.md`](13-bugs-conhecidos.md) | [`docs/wayper/13-problemas-conhecidos.md`](wayper/13-problemas-conhecidos.md), [`docs/audits/`](audits/) | Registro operacional | Vigente |
| Instruções para IA | [`AGENTS.md`](../AGENTS.md) | [`docs/14-instrucoes-para-ia.md`](14-instrucoes-para-ia.md), este catálogo | Fonte operacional | Vigente |

## Matriz: tipo de tarefa e leitura adicional

As fontes abaixo são adicionais ao núcleo permanente.

| Tipo de tarefa | Leitura obrigatória adicional |
| --- | --- |
| Bug durante corrida | [`docs/04-arquitetura.md`](04-arquitetura.md), [`docs/wayper/04-regras-corrida.md`](wayper/04-regras-corrida.md), [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md), [`docs/22-teste-real-corrida-background.md`](22-teste-real-corrida-background.md), [`docs/diagnostics.md`](diagnostics.md), [`docs/12-guia-de-testes.md`](12-guia-de-testes.md) e [`docs/13-bugs-conhecidos.md`](13-bugs-conhecidos.md) |
| GPS ou distância | [`docs/wayper/05-gps-e-validacao.md`](wayper/05-gps-e-validacao.md), [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md), ADR-010/027 em [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md), [`docs/05-modelo-de-dados.md`](05-modelo-de-dados.md) e [`docs/12-guia-de-testes.md`](12-guia-de-testes.md) |
| Background ou tela apagada | [`docs/product/07-experiencia-durante-a-corrida.md`](product/07-experiencia-durante-a-corrida.md), [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md), [`docs/22-teste-real-corrida-background.md`](22-teste-real-corrida-background.md), [`docs/wayper/15-checklist-validacao-corrida-ativa.md`](wayper/15-checklist-validacao-corrida-ativa.md) e [`docs/13-bugs-conhecidos.md`](13-bugs-conhecidos.md) |
| Finalização | [`docs/04-arquitetura.md`](04-arquitetura.md), [`docs/06-fluxos-de-usuario.md`](06-fluxos-de-usuario.md), ADR-030 em [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md), ADR-026/028 em [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md), [`docs/product/08-relatorio-da-expedicao.md`](product/08-relatorio-da-expedicao.md), [`docs/05-modelo-de-dados.md`](05-modelo-de-dados.md), [`docs/12-guia-de-testes.md`](12-guia-de-testes.md) e [`docs/13-bugs-conhecidos.md`](13-bugs-conhecidos.md) |
| Territórios | [`docs/15-corrida-por-zonas.md`](15-corrida-por-zonas.md), [`docs/wayper/03-mecanica-territorios.md`](wayper/03-mecanica-territorios.md), [`docs/05-modelo-de-dados.md`](05-modelo-de-dados.md), [`docs/wayper/06-xp-nivel-ranking.md`](wayper/06-xp-nivel-ranking.md), [`docs/10-regras-de-negocio.md`](10-regras-de-negocio.md) e [`docs/04-arquitetura.md`](04-arquitetura.md) |
| UI durante corrida | [`docs/product/01-principios-do-produto.md`](product/01-principios-do-produto.md), [`docs/product/07-experiencia-durante-a-corrida.md`](product/07-experiencia-durante-a-corrida.md), [`docs/wayper/04-regras-corrida.md`](wayper/04-regras-corrida.md), [`docs/wayper/09-arquitetura-tecnica.md`](wayper/09-arquitetura-tecnica.md), [`docs/09-design-e-wireframes.md`](09-design-e-wireframes.md) e [`docs/wayper/15-checklist-validacao-corrida-ativa.md`](wayper/15-checklist-validacao-corrida-ativa.md) |
| Pós-corrida | [`docs/product/08-relatorio-da-expedicao.md`](product/08-relatorio-da-expedicao.md), [`docs/06-fluxos-de-usuario.md`](06-fluxos-de-usuario.md), [`docs/05-modelo-de-dados.md`](05-modelo-de-dados.md), [`docs/wayper/05-gps-e-validacao.md`](wayper/05-gps-e-validacao.md), [`docs/product/09-economia-e-recompensas.md`](product/09-economia-e-recompensas.md), [`docs/15-corrida-por-zonas.md`](15-corrida-por-zonas.md) e [`docs/wayper/07-telas-e-fluxos.md`](wayper/07-telas-e-fluxos.md) |
| Plus ou Pro | [`docs/product/03-planos-e-entitlements.md`](product/03-planos-e-entitlements.md), [`docs/product/02-modelo-de-negocio.md`](product/02-modelo-de-negocio.md), [`docs/product/11-hipoteses-em-avaliacao.md`](product/11-hipoteses-em-avaliacao.md), [`docs/architecture/feature-flags.md`](architecture/feature-flags.md) e ADR-033 em [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md) |
| Parceiros | [`docs/product/04-parcerias-e-patrocinios.md`](product/04-parcerias-e-patrocinios.md), [`docs/product/02-modelo-de-negocio.md`](product/02-modelo-de-negocio.md), [`docs/product/09-economia-e-recompensas.md`](product/09-economia-e-recompensas.md), [`docs/product/12-criterios-para-novas-features.md`](product/12-criterios-para-novas-features.md) e ADR-034 em [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md) |
| Pagamentos | [`docs/product/direcao-estrategica-completa.md`](product/direcao-estrategica-completa.md), [`docs/product/02-modelo-de-negocio.md`](product/02-modelo-de-negocio.md), ADR-035 em [`docs/architecture/adrs-direcao-oficial.md`](architecture/adrs-direcao-oficial.md), [`docs/product/11-hipoteses-em-avaliacao.md`](product/11-hipoteses-em-avaliacao.md), [`docs/product/03-planos-e-entitlements.md`](product/03-planos-e-entitlements.md) e [`docs/architecture/feature-flags.md`](architecture/feature-flags.md); confirme a ausência atual de contrato implementado |
| Build ou deploy | [`docs/11-plano-de-deploy.md`](11-plano-de-deploy.md), `package.json`, `.env.example`, [`docs/12-guia-de-testes.md`](12-guia-de-testes.md), [`docs/diagnostics.md`](diagnostics.md) e [`docs/13-bugs-conhecidos.md`](13-bugs-conhecidos.md) |
| Documentação ou instruções de agentes | [`docs/14-instrucoes-para-ia.md`](14-instrucoes-para-ia.md), [`docs/product/README.md`](product/README.md), [`docs/wayper/00-index.md`](wayper/00-index.md), [`docs/08-decisoes-tecnicas.md`](08-decisoes-tecnicas.md), [`docs/18-changelog-produto.md`](18-changelog-produto.md) e [`docs/19-revisoes-de-implementacao.md`](19-revisoes-de-implementacao.md) |

## Protocolo de conflito

1. Registre a divergência.
2. Confirme o comportamento atual em código, teste, configuração ou evidência.
3. Identifique a fonte de estado atual e a fonte de direção aprovada.
4. Não permita que código legado revogue estratégia nem que documento futuro
   finja implementação atual.
5. Atualize ou marque a fonte desatualizada, sem apagar seu histórico.
6. Registre decisão relevante em ADR ou documento equivalente.
7. Se duas decisões aprovadas forem incompatíveis, marque a lacuna como
   bloqueada e peça decisão humana.

## Política de manutenção

- Toda mudança significativa atualiza a fonte temática correspondente.
- Decisão técnica relevante exige ADR ou registro equivalente.
- Documento substituído é marcado como `substituído` ou `histórico`; não é
  apagado silenciosamente.
- Links persistidos são relativos ao repositório; caminhos absolutos da máquina
  são proibidos na documentação versionada.
- Documento desatualizado deve ser corrigido ou marcado claramente.
- Duplicações devem ser consolidadas: cada tema possui uma fonte principal e as
  demais resumem e apontam para ela.
- Auditoria, changelog, checklist ou plano datado não vira fonte normativa.
- Status de documento não prova maturidade de código, teste físico ou deploy.
