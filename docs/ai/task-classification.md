# Task Classification — Wayper AI Harness V1

> **Status:** vigente<br>
> **Escopo:** decisões operacionais do repositório mobile<br>
> **Owner:** [`docs/ai/harness-v1.md`](harness-v1.md)<br>
> **Aplicação:** sob demanda, antes de carregar contexto de domínio

Este classificador escolhe o menor workflow seguro. Ele interpreta objetivo,
efeito e evidência; palavras isoladas não classificam uma tarefa. A classe pode
ser provisória durante a primeira inspeção e deve escalar quando surgir risco.

## Classes primárias

| Classe | Quando usar | Rota de processo |
| --- | --- | --- |
| `TRIVIAL` | Mudança pequena, inequívoca, local e de baixo risco, como texto, spacing, rename local, comentário ou doc curta | nativo: inspect, edit, targeted validation |
| `BOUNDED` | Mudança funcional delimitada dentro de owner e arquitetura existentes | nativo: targeted context, short plan, implementation, validation, light review |
| `INVESTIGATION` | O objetivo é localizar, explicar, diagnosticar ou auditar | nativo: evidence, map, verify, conclusion |
| `BUG` | Há comportamento incorreto, regressão ou sintoma verificável | `BUG_INVESTIGATION` |
| `ARCHITECTURAL` | Muda ownership/boundary, cria subsistema ou abstração importante, cruza domínios ou exige migração | `ARCHITECTURAL_CHANGE` |

Os contratos detalhados e a decisão entre workflow nativo/skill estão em
[`docs/ai/process-workflows.md`](process-workflows.md). A classe continua sendo
owner da seleção; o documento de processo não reclassifica a tarefa.
Gate e review proporcionais são selecionados depois da inspeção do diff, pela
matriz de [`quality-gates.md`](quality-gates.md).

`INVESTIGATION` não produz código permanente por padrão. Um pedido de
refatoração não vira `ARCHITECTURAL` pela palavra usada: precisa alterar
estrutura, ownership, fronteira ou vários domínios. Um relato de comportamento
incorreto começa como `BUG`; se a evidência ainda for insuficiente, a primeira
fase continua sendo investigação da causa.

## Override `CRITICAL_RUNTIME`

`CRITICAL_RUNTIME` não substitui a classe primária. Ele a sobrepõe quando a
tarefa pode afetar perda/corrupção de corrida, duração, distância, GPS, estado
canônico, concorrência, lifecycle, background, foreground, tela apagada, task
nativa, notificação, recovery, pause/resume, finish, save local ou processamento
deferido ligado à corrida.

Exemplo: um defeito de distância após background é `BUG + CRITICAL_RUNTIME`.
Texto, cor ou animação em uma tela que menciona corrida não ativa o override sem
efeito real sobre o runtime.

O contexto mínimo do override é:

1. `wayper-active-run`;
2. owners atuais do fluxo afetado;
3. testes relacionados;
4. invariantes de corrida do `AGENTS.md`;
5. mapa de lifecycle quando a flag `LIFECYCLE` existir.

Revisores são escolhidos pelas flags, nunca todos por padrão. Storage/recovery
sem geometria não requer reviewer geoespacial; GPS/filtros requer; background ou
notificação requer lifecycle e pode requerer concorrência.

## Risk flags

Flags são combináveis e descrevem o risco concreto, não o nome do arquivo.

| Flag | Sinal de uso |
| --- | --- |
| `RUN_DATA_LOSS` | corrida, amostra, duração, distância ou save pode desaparecer/corromper |
| `LIFECYCLE` | mount/unmount, AppState, background/foreground, tela apagada, headless ou recovery |
| `CONCURRENCY` | ordering, single-flight, callback obsoleto, lock, cancelamento ou writers concorrentes |
| `GPS_GEO` | localização, filtros, distância, coordenadas, rota, polígono ou projeção |
| `OFFLINE_STORAGE` | persistência local, recovery, durabilidade, fallback ou indisponibilidade de rede |
| `SYNC` | fila, replay, retry, idempotência ou consistência local/remota |
| `FIREBASE` | Firebase Auth, Firestore, regras, SDK ou configuração Firebase |
| `AUTH_SECURITY` | identidade, autorização, permissões de dados, segredo ou trust boundary |
| `NATIVE_ANDROID` | manifest, Kotlin/Java, service, receiver, notification channel, Gradle ou task nativa |
| `PERFORMANCE` | latência, bloqueio, memória, frequência de render/write ou trabalho pesado |
| `DATA_MIGRATION` | schema/shape persistido, compatibilidade, backfill ou migração |
| `UI_UX` | apresentação, interação, acessibilidade, estados visuais ou feedback |
| `PRODUCT_RULE` | regra, entitlement, economia, ranking, comportamento aprovado ou decisão de produto |
| `DOCUMENTATION` | fonte documental, link, instrução, owner ou registro técnico |
| `BUILD_TOOLING` | teste, build, dependency, script, CI, Expo/EAS, Gradle ou configuração de ferramenta |

## Escalation

Escale a classe ou o nível de contexto quando a inspeção revelar:

- mudança de owner ou boundary;
- novo estado persistente ou migração;
- vários domínios com responsabilidade real;
- concorrência, lifecycle ou risco de perda de corrida;
- segurança/autorização;
- mudança de API pública;
- workaround que começa a criar arquitetura paralela.

Uma `BOUNDED` que muda ownership vira `ARCHITECTURAL`. Um `BUG` que ameaça a
corrida recebe `CRITICAL_RUNTIME`. Risco comprovado não é rebaixado
automaticamente; só pode ser encerrado por evidência e validação explícitas.

## Context levels

| Nível | Conteúdo | Regra de subida |
| --- | --- | --- |
| `LEVEL 0 — PERMANENT` | `AGENTS.md` e metadata de descoberta de skills/agents | sempre; nenhum doc de domínio por padrão |
| `LEVEL 1 — TASK ROUTING` | classe, flags e menor rota do mapa de contexto | qualquer tarefa não resolvida no nível 0 |
| `LEVEL 2 — DOMAIN` | uma ou poucas skills/docs e owners do domínio | tarefa funcional ou risco de domínio conhecido |
| `LEVEL 3 — DEEP INVESTIGATION` | source, callers, testes, docs específicos, Graphify quando útil e especialistas seletivos | incerteza estrutural, bug complexo ou impacto amplo |
| `LEVEL 4 — CRITICAL` | lifecycle completo, failure modes, matriz de testes, evidência arquitetural e múltiplos reviewers apenas pelas flags | runtime crítico ou risco excepcional comprovado |

Não suba nível por cerimônia. `LEVEL 4` não significa spawnar todos os
especialistas.

## Contrato interno opcional

Para tarefas não triviais, o agente pode manter este resumo no plano interno,
sem imprimi-lo em toda resposta:

```text
TASK_CLASS:
RISK_FLAGS:
DOMAINS:
CONTEXT_LEVEL:
GATE_LEVEL:
REVIEW_MODE:
PROCESS:
SKILLS:
SPECIALISTS:
VALIDATION:
```

## Auditoria conceitual do `wayper-brain`

O Brain permanece depreciado em backup externo e não é dependência deste
Harness. A evidência histórica foi classificada assim:

| Decisão | Conceitos |
| --- | --- |
| `REUSE_CONCEPT` | classe separada de risco; menor conjunto de domínios; escalada por evidência; validação barata antes da ampla; specialist por risco; Graphify sob demanda |
| `ALREADY_COVERED` | source como confirmação; progressive disclosure; papéis genéricos nativos; um único writer; invariantes local-first |
| `TOO_COMPLEX` | budgets de spawn/compute, ladder fixo de modelos, ledger de reviews, rounds obrigatórios e contratos extensos de dispatch |
| `STALE` | nomes/modelos fixos, agents/skills antigos, dependência do site, Superpowers e paths/config do workspace anterior |
| `REJECT` | Brain como orquestrador mestre, router executável central, papéis genéricos customizados, seleção automática de modelo e cópia literal da implementação |

O agente principal do Codex continua sendo o orquestrador; este documento é uma
política declarativa.
