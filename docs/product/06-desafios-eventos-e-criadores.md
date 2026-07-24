# Desafios, eventos e criadores

**Status:** aprovado conceitualmente

A arquitetura pode suportar usuários, criadores, grupos, academias, empresas,
marcas, comunidades e organizações esportivas como produtores de experiências.

## Capacidades futuras

- desafios públicos, privados, patrocinados ou pagos;
- campeonatos, ligas, eventos e temporadas;
- inscrições, premiações e rankings específicos;
- convites, clubes e comunidades;
- ferramentas de organização e gestão.

## Limites atuais

- nenhuma capacidade acima está autorizada em produção por este documento;
- atividade segura independe de evento, pagamento ou API de organizador;
- desafios escolhidos antes da corrida não podem incentivar comportamento
  perigoso durante ela;
- regras, elegibilidade, premiação e auditoria ficam fora de componentes;
- cobrança, split e repasse exigem decisões jurídicas, comerciais e técnicas
  específicas;
- integrações usam contratos substituíveis e feature flags.

O primeiro passo futuro é modelar identidade do organizador, regras do desafio,
participação e resultado idempotente — não construir um marketplace.
