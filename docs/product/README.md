# Direção de produto

> **Status:** vigente<br>
> **Tipo:** índice temático<br>
> **Escopo:** produto, negócio e experiência<br>
> **Última revisão:** 2026-08-01<br>
> **Fonte principal:** [`docs/product/direcao-estrategica-completa.md`](direcao-estrategica-completa.md)

Este diretório organiza a direção de produto e negócio da Wayper. A fonte
normativa principal é
[`direcao-estrategica-completa.md`](direcao-estrategica-completa.md); os arquivos
numerados são recortes temáticos complementares e não criam versões concorrentes
da estratégia.

## Leitura

1. [Direção estratégica completa](direcao-estrategica-completa.md)
2. [Visão oficial](00-visao-oficial.md)
3. [Princípios do produto](01-principios-do-produto.md)
4. [Experiência durante a corrida](07-experiencia-durante-a-corrida.md)
5. [Relatório da Expedição](08-relatorio-da-expedicao.md)
6. [Decisões aprovadas](10-decisoes-aprovadas.md)
7. [Hipóteses em avaliação](11-hipoteses-em-avaliacao.md)
8. [Critérios para novas features](12-criterios-para-novas-features.md)

Modelo de negócio, planos, parcerias, monetização, eventos, economia e analytics
estão nos demais documentos numerados. A estratégia de flags está em
[`docs/architecture/feature-flags.md`](../architecture/feature-flags.md).

## Como interpretar

- a direção completa define decisões e limites aprovados;
- os documentos temáticos explicam domínios e podem registrar maturidade local;
- “aprovado conceitualmente” orienta arquitetura, mas não autoriza integração;
- hipótese ou item em validação não autoriza código de produção;
- a presença de um conceito não significa que ele esteja implementado;
- código, testes e configuração de `develop` mostram o estado atual;
- auditorias em [`docs/audits/`](../audits/) são evidências datadas, não fontes
  normativas permanentes;
- ADRs ficam em
  [`docs/architecture/adrs-direcao-oficial.md`](../architecture/adrs-direcao-oficial.md)
  e [`docs/08-decisoes-tecnicas.md`](../08-decisoes-tecnicas.md).

A hierarquia completa e o protocolo de divergência estão em
[`docs/00-fontes-do-projeto.md`](../00-fontes-do-projeto.md).
