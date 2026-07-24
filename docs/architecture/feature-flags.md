# Estratégia de feature flags

**Status:** contrato planejado; não implementado

## Objetivo

Permitir rollout incremental, teste e desligamento emergencial sem colocar
configuração remota no tracking ou espalhar condicionais pelas telas.

## Contrato conceitual

Um resolvedor central recebe nome, ambiente, contexto local e último estado
conhecido. Ele retorna valor, origem, versão e horário.

Defaults são seguros:

- tracking, salvamento e recovery nunca são desligados remotamente;
- experiência comercial nova começa desativada;
- ausência de rede usa default local ou último valor compatível;
- dependência inválida desativa a feature dependente;
- provider remoto nunca é chamado no caminho de GPS.

## Flags planejadas

- `expedition_report_v1`;
- `focus_run_ui`;
- `progression`, `achievements`, `streaks`;
- `rewards`, `partners`, `challenges`;
- `ads`;
- `wayper_plus`, `wayper_pro`;
- `payments`, `store`, `seasons`, `waycoins`;
- `sponsored_territories`.

## Ciclo de vida

Toda flag declara owner, status, default, ambientes, dependências, métrica,
rollback e data/critério de remoção. Flags estabilizadas devem ser removidas com
commit próprio; não viram configuração permanente acidental.

## Testes

- default sem provider;
- cache ausente/corrompido;
- ambiente e rollout;
- dependências incompatíveis;
- kill switch;
- mudança durante atividade sem alterar sessão canônica;
- falha remota neutra.
