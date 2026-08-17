# Hooks e Automated Gates — Wayper AI Harness V1

> **Status:** vigente<br>
> **Runtime auditado:** `codex-cli 0.147.0`, 2026-08-17<br>
> **Superfície testada:** `codex exec` local/headless em Linux<br>
> **Owner:** Harness/`TEST_BUILD`; Q/R continuam em
> [`quality-gates.md`](quality-gates.md)<br>
> **Drift:** repetir a capability matrix quando a versão do Codex mudar
> materialmente

## Contrato

Hooks removem validação determinística repetitiva; não tomam decisões
semânticas. O agente ainda escolhe Q0-Q3, R0-R3, targeted tests, review, deep
checks e validação física. A única automação project-scoped adotada é um
completion backstop em `Stop`.

```text
agent validation / review
          ↓
attempted Stop
          ↓
scope deterministicamente observável
          ↓
checks mínimos aplicáveis
          ↓
PASS | FAIL | SKIP | TOOLING_ERROR
```

Não existem hooks project-scoped de `PreToolUse`, `PostToolUse`,
`SessionStart`, `UserPromptSubmit`, compactação ou subagent. Não há daemon,
watcher, auto-fix, auto-baseline, auto-commit, auto-push ou memory promotion.

## Runtime e configuração reais

O binário auditado reporta `codex-cli 0.147.0` e feature `hooks` estável/ativa.
O formato confirmado é TOML para config e JSON/TOML para hooks. As fontes
ativas podem coexistir; hooks correspondentes de camadas diferentes são
mesclados, não substituídos por precedência.

Fontes externas auditadas: [Codex Hooks](https://learn.chatgpt.com/docs/hooks),
[config básica](https://learn.chatgpt.com/docs/config-file/config-basic) e
[referência de config](https://learn.chatgpt.com/docs/config-reference), sempre
confirmadas contra o CLI instalado e o smoke local.

| Scope | Location | Estado/owner |
| --- | --- | --- |
| `USER_GLOBAL` | `~/.codex/config.toml`, `~/.codex/hooks.json` | preferências e RTK do usuário; preservados |
| `SHARED_WORKSPACE` | `<workspace>/.codex/` | agents compartilhados e adapter RTK referenciado pelo global; preservados |
| `WAYPER_PROJECT` | `.codex/hooks.json` | `Stop` backstop versionado nesta unidade |
| `PLUGIN` | manifests/cache dos plugins habilitados | lifecycle do Ponytail; preservado |
| `GIT_LOCAL` | `.git/hooks/` | Graphify `post-commit`/`post-checkout`; preservados |
| `SYSTEM/MANAGED` | `/etc/codex/config.toml`, `/etc/codex/requirements.toml` | ambos ausentes no host auditado |

Precedência de config observada/documentada, da maior para a menor: flags
CLI/`--config`, `.codex/config.toml` do project root até o cwd (mais próximo
vence), profile, `~/.codex/config.toml`, system e defaults. Wayper e o workspace
pai não possuem `.codex/config.toml`; hooks JSON das fontes habilitadas são
agregados, não tratados como override dessa ordem.

Project hooks só carregam em projeto confiável e cada definição command precisa
de review pelo hash. `/hooks` é o owner interativo desse trust. O smoke test usou
`--dangerously-bypass-hook-trust` somente na sessão descartável; isso não é
política do projeto nem substitui review.

## Ownership dos hooks existentes

| Name | Location/scope | Owner/event | Purpose/cost | Failure mode | Decision |
| --- | --- | --- | --- | --- | --- |
| RTK command adapter | `~/.codex/hooks.json` → `<workspace>/.codex/hooks/rtk-codex.js`; `USER_GLOBAL`/`SHARED_WORKSPACE` | user; `PreToolUse:Bash` | adaptação RTK; timeout 5 s | best-effort/fail-open | `KEEP` |
| Ponytail lifecycle 4.9.0 | plugin manifest/cache; `PLUGIN` | plugin; `SessionStart`, `UserPromptSubmit`, `SubagentStart` | regras/mode tracking; timeout 5 s por handler | best-effort/fail-open | `KEEP` |
| Wayper completion backstop | `.codex/hooks.json`; `WAYPER_PROJECT` | Harness; `Stop` | gate por scope; 43 ms–9,84 s medidos | blocker em `FAIL`/`TOOLING_ERROR` do script; runtime pode fail-open | `ADD` |
| Graphify post-commit | `.git/hooks/post-commit`; `GIT_LOCAL`/`GENERATED_RUNTIME` | Graphify; Git `post-commit` | update assíncrono; só custo de launch no Git foreground | detached/fail-open | `KEEP` |
| Graphify post-checkout | `.git/hooks/post-checkout`; `GIT_LOCAL`/`GENERATED_RUNTIME` | Graphify; Git `post-checkout` | refresh assíncrono em troca de branch; só launch foreground | detached/fail-open | `KEEP` |

Não há `pre-commit`, `pre-push` ou hooks do plugin Superpowers. Nenhum hook
existente foi sobrescrito ou removido.

## Capability matrix

`AVAILABLE` vem do binário 0.147.0 e da documentação da release. `OBSERVED`
significa que o evento disparou no smoke local; outros hosts/surfaces continuam
`UNKNOWN`.

| Event | Available | Fires in current surface | Can block | Can return feedback | Payload observed | Failure semantics | Reliability | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `PreToolUse` | yes | Bash/apply_patch observed | contract: yes for supported tools; not exercised | contract: yes | `tool_name`, `tool_input`, `tool_use_id` | handler failure not tested | `LIMITED` | `DO_NOT_USE` |
| `PermissionRequest` | yes | not observed (`approval=never`) | `UNKNOWN` here | `UNKNOWN` here | none | not tested | `UNKNOWN` | `DO_NOT_USE` |
| `PostToolUse` | yes | success, exit 7 and writes observed | no rollback after effect | contract: yes | `tool_name`, `tool_response`, `tool_use_id` | handler failure not tested | `LIMITED` | `DO_NOT_USE` |
| `PreCompact` | yes | not tested | `UNKNOWN` here | `UNKNOWN` here | none | not tested | `UNKNOWN` | `DO_NOT_USE` |
| `PostCompact` | yes | not tested | `UNKNOWN` here | `UNKNOWN` here | none | not tested | `UNKNOWN` | `DO_NOT_USE` |
| `SessionStart` | yes | observed | not adopted/tested | contract: context/message | `source`, `model`, `permission_mode` | missing/non-zero/timeout were silent; continued | `LIMITED` | `DO_NOT_USE` |
| `SessionEnd` | yes | observed | no | no steering adopted | `reason` | not tested | `LIMITED` | `DO_NOT_USE` |
| `UserPromptSubmit` | yes | observed | not exercised | contract: yes | `prompt`, `turn_id` | not tested | `LIMITED` | `DO_NOT_USE` |
| `SubagentStart` | yes | not tested | `UNKNOWN` here | `UNKNOWN` here | none | not tested | `UNKNOWN` | `DO_NOT_USE` |
| `SubagentStop` | yes | not tested | `UNKNOWN` here | `UNKNOWN` here | none | not tested | `UNKNOWN` | `DO_NOT_USE` |
| `Stop` | yes | block + continuation observed | yes, observed | yes, observed | `stop_hook_active`, `last_assistant_message` | valid block continued; malformed output was silent/fail-open | handler `RELIABLE_ENOUGH`; runtime failure `LIMITED` | `USE` |

Desktop, IDE, app-server e cloud não foram testados: `UNKNOWN`. Paths do handler
são relativos ao Git root, mas shell/semantics só foram validados no CLI Linux;
nenhuma equivalência de superfície ou suporte Windows é alegada.

## Smoke test controlado

Probes temporários escreveram somente metadata sanitizada em `/tmp` e foram
removidos. Nenhum transcript, prompt, tool output ou dado do produto foi
versionado.

| Probe | Resultado |
| --- | --- |
| `--ignore-user-config` control | temporary project hook did not load on that invocation |
| start/prompt/end | `SessionStart`, `UserPromptSubmit`, `SessionEnd` observed |
| Bash success | Pre/Post observed |
| Bash exit 7 | Post observed após non-zero |
| shell write | Pre/Post `Bash`; arquivo temporário criado |
| `apply_patch` write | Pre/Post `apply_patch`; arquivo temporário criado |
| Stop block | first Stop returned continuation; second payload had `stop_hook_active=true` |
| missing command | handler tentou executar; nenhum erro apareceu no stream JSON; Codex continuou |
| hook exit non-zero | marker confirmou execução; nenhum erro apareceu no stream JSON; Codex continuou |
| malformed Stop JSON | marker confirmou execução; nenhum erro apareceu no stream JSON; Codex completou |
| SessionStart timeout | marker confirmou início; nenhum erro apareceu no stream JSON; Codex completou |
| backstop real em diff inválido | `FAIL` chegou ao agente; segundo Stop ficou ativo e não repetiu o blocker |
| Permission/compact/subagent | not observed/not tested |

Shell e `apply_patch` estão cobertos no caminho local observado, mas hosted tools
e paths especializados podem não passar por tool hooks. Além disso, shell pode
escrever arbitrariamente dentro das permissões sem o hook compreender a
semântica do comando. Portanto Pre/Post tool hooks **não são write security
boundary**.

## Completion backstop

`.codex/hooks.json` registra somente `Stop`, com timeout de 120 s, proporcional
ao FAST prático e suficiente para limitar hang externo. O handler resolve o Git
root, inclui tracked/staged/untracked changes e executa
`scripts/quality/check-completion-backstop.mjs --hook`. Timeout/morte do shell
pelo próprio runtime permanece fail-open na superfície observada; não há
fallback bloqueante que pudesse repetir indefinidamente sem ler o payload.

`git diff --check` não cobre arquivos untracked. O backstop usa o próprio
`git diff --no-index --check` para esses arquivos, sem parser custom, staging ou
write automático.

`stop_hook_active=true` não roda nem bloqueia de novo. O limite de uma
continuação evita loop infinito. Se o primeiro feedback não for tratado, a
responsabilidade permanece com o agente e seu Quality Status; o hook não é um
lock de segurança.

O comando manual equivalente é:

```sh
npm run quality:backstop
```

Não há cache/fingerprint. Um cache correto precisaria cobrir untracked content,
config, baselines e scripts; a complexidade não compensou uma execução por
attempted completion. Validação manual repetida do mesmo diff pode ser
duplicada conscientemente.

O command requer shell POSIX, Node, npm e Git como o app já requer. Não contém
path de usuário: `git rev-parse --show-toplevel` suporta o checkout principal e
worktrees. Dirty worktree é lida sem `stash`, `reset`, `checkout` ou `clean`.
Cada subprocesso tem timeout próprio; muitos untracked files ainda podem atingir
o timeout externo, limitação preferível a cache/daemon ou parser custom.

## Changed-scope

Scope é classificação de paths, não substituto de task class, risk flags ou
Q-level.

| Scope | Seleção determinística |
| --- | --- |
| `NO_CHANGES` | `SKIP`, nenhum processo de quality |
| `DOCS_ONLY` | `git diff --check HEAD --` |
| `HARNESS_ONLY` | teste do backstop se afetado + diff check; evals/links continuam agent-owned |
| `PRODUCT_SOURCE` | `npm run quality:gate -- --json` |
| `TESTS` | FAST gate; targeted semantic tests continuam agent-owned |
| `QUALITY_TOOLING` | teste diretamente associado + FAST gate |
| `PACKAGE_CONFIG` | FAST gate; Expo/dependency validation é DEEP selecionado pelo agente |
| `NATIVE_ANDROID` | FAST gate; device/lifecycle continuam pendentes quando necessários |
| `MIXED` | união dos testes de tooling aplicáveis + FAST gate |

Os testes associados são somente os owners existentes de size, architecture,
quality gate e completion backstop. Não foi criado test-impact engine nem parser
de Markdown. Typo/docs comum não roda ESLint completo, Jest ou Expo Doctor.

## FAST e DEEP

Automação FAST do hook:

- diff whitespace para docs/Harness;
- diff whitespace de arquivos untracked via Git;
- testes unitários do quality tool alterado;
- `quality:gate` para source, tests, quality tooling, package/config, Android e
  mixed.

Continuam agent-driven:

- targeted tests sem relação mecânica inequívoca;
- full Jest;
- Expo Doctor/config e dependency/build checks;
- review R0-R3 e especialistas;
- semântica arquitetural, failure-mode review e Graphify;
- validação física de screen-off, foreground service, notification, headless
  task e GPS real.

`FAST_HOOK_PASS` nunca significa `PHYSICAL_VALIDATION_PASS` ou qualidade total.
Para Q3, `PHYSICAL_VALIDATION_PENDING` continua `INCONCLUSIVE` quando aparelho é
necessário.

## Failure semantics e output

| State | Significado | Stop behavior |
| --- | --- | --- |
| `PASS` | checks aplicáveis passaram | stdout vazio |
| `SKIP` | sem diff/check aplicável | stdout vazio |
| `FAIL` | gate/test/diff determinístico falhou ou evidência obrigatória ficou inconclusiva | continuation compacta com comando de detalhe |
| `TOOLING_ERROR` | processo, timeout ou JSON do gate falhou | continuation distinta; investigar tooling |

Exemplo `FAIL` medido: 121 bytes JSON, contendo só status, blocker e um comando
de detalhe; `TOOLING_ERROR` representativo: 215 bytes.
PASS/SKIP em hook mode: 0 bytes.

O script captura seus próprios erros e retorna `TOOLING_ERROR`. Fora desse
envelope, o smoke de `codex exec --json` mostrou que command ausente, non-zero,
timeout e output malformado podem ser silenciosos e fail-open. Isso não é
convertido falsamente em falha do código. O agente deve
registrar `TOOLING_BLOCKER` após retry racional se a ferramenta essencial
continuar indisponível.

## Trust e security boundary

Codex hook não é sandbox; Git hook não é CI; ESLint não é semantic review.
Qualquer um pode estar desabilitado, sem trust, indisponível, limitado por
surface ou falhar. Segurança e qualidade continuam sustentadas por permissões
do ambiente, source, testes, gates explícitos, review e validação deep/física.

O backstop nunca:

- altera arquivos, baselines ou Git history;
- executa `--fix`, formatter write ou audit fix;
- stasha, reseta, limpa ou faz checkout de worktree dirty;
- faz commit, push, deploy ou mutation externa;
- salva logs, transcript ou memory;
- seleciona specialist, next candidate ou `GOAL_SATISFIED`.

## Git hooks e ownership

Os hooks locais Graphify `post-commit` e `post-checkout` foram preservados. Não
há `pre-commit`, `pre-push` nem hook manager do projeto. A decisão é
`NO_PRECOMMIT`/`NO_PREPUSH`: o completion backstop e a validação adaptativa já
cobrem o FAST local; adicionar outro FAST gate duplicaria custo e ainda não
substituiria CI/deep validation.

Hooks globais RTK e lifecycle de plugin foram preservados. Wayper-specific
validation fica no projeto; otimização genérica continua user-global.

## Performance e economia

Não existem project hooks em tool-call, start, prompt, compact ou subagent;
portanto 100 tool calls projetam **0 execuções** do backstop e overhead
project-scoped de aproximadamente 0 s/0 bytes.

| Event/scenario | Commands run | Practical sample | Output |
| --- | --- | --- | --- |
| `Stop`/no changes | Git root + two changed-file queries | p50 43,2 ms (5 runs) | 0 bytes |
| `Stop`/docs only | Git discovery + untracked/diff checks | p50 51,2 ms (5 runs) | 0 bytes |
| `Stop`/product-equivalent mixed diff | associated tooling test + FAST gate | 9,84 s (1 run) | 0 bytes |
| 100 tool calls | no project hook | 0 commands/backstops; projected 0 s | 0 bytes |

Um hook frequente de 0,1 s, 2 s ou 10 s custaria respectivamente 10 s, 200 s
ou 1.000 s em 100 tool calls. Por isso `quality:gate` não entra em
`PostToolUse`; o custo FAST ocorre no máximo na tentativa de completion.

Success é silencioso. Failure não inclui lint completo, Jest, diff ou stack
trace; o comando indicado abre detalhes sob demanda.

## Meta Goal e limitações

Em uma Meta, cada slice continua usando Execution Kernel e Q/R próprios. O Stop
hook apenas captura uma tentativa acidental de concluir com regressão
determinística; não forma waves, rankeia candidates, decide produto, promove
memory ou marca Goal satisfied.

Limitações confirmadas:

- apenas CLI/headless local foi smoke-tested;
- `codex exec --ignore-user-config` não carregou o project probe no smoke;
- shell POSIX/Linux é requisito testado; Windows permanece `UNKNOWN`;
- project hook novo/alterado requer trust por hash;
- hosted/specialized tool paths podem não disparar Pre/Post;
- falha interna ao script retorna `TOOLING_ERROR`, mas falha do runtime do hook
  pode ser silenciosa/fail-open em `codex exec --json`;
- nenhuma validação física pode ser inferida;
- declarative Harness evals e Markdown links continuam validação do agente;
- nenhuma deduplicação de FAST já executado foi adicionada.

## Self-test e drift

```sh
node --test scripts/quality/check-completion-backstop.test.mjs
npm run quality:backstop
```

Os testes cobrem scopes, pass/debt, bug signal, size, architecture, untracked
whitespace, malformed JSON, process/timeout failure, output compacto e proteção
contra Stop loop, inclusive stderr silencioso em tooling failure. Ao alterar
Codex materialmente, revalidar eventos, trust, payload, blocking, failure
semantics, tool coverage e surfaces antes de ampliar guarantees.
