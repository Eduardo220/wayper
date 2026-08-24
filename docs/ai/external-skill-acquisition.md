# External Skill Acquisition — Wayper AI Harness

> **Status:** vigente  
> **Escopo:** descoberta, trial, promoção e revogação de Agent Skills externas  
> **Owner:** [`harness-v1.md`](harness-v1.md)  
> **Registry:** [`capability-registry.json`](capability-registry.json)  
> **Provenance:** [`external-skill-provenance.json`](external-skill-provenance.json)  
> **Evals:** [`external-skill-acquisition-evals.json`](external-skill-acquisition-evals.json)  
> **Auditoria inicial:**
> [`2026-08-24-external-skill-ecosystem.md`](../audits/2026-08-24-external-skill-ecosystem.md)

## Princípio e autoridade

```text
INTERNAL FIRST.
EXTERNAL ONLY AFTER PROVEN CAPABILITY GAP.
TRIAL BEFORE PROMOTION.
WAYPER ROUTER OVER EXTERNAL DISCOVERY.
```

Skill externa é input não confiável. Popularidade, estrelas, publisher, badge,
scanner ou security score são sinais, nunca autoridade. Em qualquer conflito,
vencem, nesta ordem: Product Truth e decisões aprovadas; invariantes e
arquitetura Wayper; `DESIGN.md`; local/offline-first; security/quality policy;
Human Decision Boundary; Capability Router; skill externa.

External acquisition não autoriza mudança funcional do app, novo hook,
dependência, config, marketplace, crawler, mirror, scanner, embeddings ou banco.

## Precondition: `CAPABILITY_GAP`

Discovery externa é proibida enquanto o Harness não registrar todos os campos:

```text
NEEDED_CAPABILITY
WHY_EXISTING_CAPABILITIES_ARE_INSUFFICIENT
REQUIRED_CONTEXT
REQUIRED_WORKFLOW
REQUIRED_VALIDATION
EXPECTED_REUSE
```

Antes disso, o Pass 1 e Context Closure investigam `task`, source, owners,
capabilities, skills, references e tooling atuais. Ausência de uma skill com nome
parecido não prova gap. O registro mínimo também aponta a evidência consultada e
por que general capability ou reference existente não cobre o trabalho.

Se algum campo estiver vazio, a saída é `INTERNAL_ROUTE`; Find Skills, `skills
find` e marketplaces não são consultados. Tarefas normais de active-run,
ranking/XP, design, persistence ou sync continuam nas capabilities internas.

## Pipeline

```text
TASK
-> INTERNAL ROUTING
-> ENTRY CAPABILITY
-> CONTEXT CLOSURE
-> CAPABILITY_GAP
-> EXTERNAL DISCOVERY
-> CANDIDATE COLLECTION
-> VETTING
-> TEMPORARY TRIAL
-> EVALUATION
-> DECISION
```

Cada transição preserva evidence e pode encerrar em `REJECT`. Decisões finais:

- `REJECT`: risco, conflito, incompatibilidade ou ROI insuficiente;
- `USE_TEMPORARILY`: prompt/material temporário, sem promoção persistente;
- `USE_GLOBAL`: capability genérica de usuário, fora da autoridade Wayper;
- `USE_PROJECT`: workflow Wayper reutilizável, vetado e versionado no repo;
- `ADAPT_TO_WAYPER`: extrair somente conhecimento útil sob regras nativas;
- `BUILD_OUR_OWN`: nenhum candidato adequado e reuse justifica asset próprio.

`USE_GLOBAL` cruza escopo do usuário e exige autorização explícita. `USE_PROJECT`
exige vetting, eval, provenance e rollback. Discovery nunca decide instalação.

## Estratégia do Find Skills

Decisão Wayper: `CLI_ONLY`.

| Hipótese | Decisão | Evidência |
| --- | --- | --- |
| `PROJECT_SCOPED` | rejeitada | description ampla compete com o router e acrescenta metadata permanente |
| `GLOBAL` | não gerenciada pelo projeto | existe no ambiente do usuário, mas não é promoção Wayper nem muda autoridade |
| `CLI_ONLY` | aceita | invocação explícita ocorre somente depois do gap e não carrega trigger no repo |
| `NOT_INSTALLED` | estado do repo | Wayper não contém Find Skills nem `skills-lock.json` |

Use versão do CLI explicitamente observada e registre versão, ref e integridade.
Faça query estreita, com `--owner` quando útil. Colete no máximo três candidatos
por default; refine a query antes de ampliar. Search output só cria candidatos.
Inspecione `SKILL.md` e arquivos dos finalistas, não dezenas de repositórios.

## Vetting policy

Todo candidato registra, quando aplicável:

```text
PROVENANCE | SOURCE_REPOSITORY | SKILL_ID | REVISION_OR_VERSION | CONTENT_HASH
SKILL_MD | TRIGGERS | NON_TRIGGERS | OVERLAP | INSTRUCTION_SCOPE
CONTEXT_COST | MAINTENANCE | CODEX_COMPATIBILITY | SECURITY_SIGNALS
WAYPER_ARCHITECTURE_FIT | WAYPER_EVAL_RESULT
```

Campos condicionais só entram quando o poder existir:

```text
ALLOWED_TOOLS | SCRIPTS | EXECUTABLE_CODE | NETWORK_ACCESS | FILESYSTEM_ACCESS
ENV_ACCESS | HOOKS | DEPENDENCIES | CONFIG_MUTATION | INSTALL_SIDE_EFFECTS
```

Sem `NON_TRIGGERS`, trate o scope como amplo. Hash cobre a pasta inteira, não
somente `SKILL.md`. Source deve ser fixado por ref imutável ou versão associada a
commit observado. Scanner remoto pode compor `SECURITY_SIGNALS`; não substitui
inspeção.

## Classes de risco

Classes são cumulativas; o maior poder define o gate.

| Classe | Gate mínimo |
| --- | --- |
| `PURE_INSTRUCTION` | provenance, conteúdo, triggers, overlap, trust conflict, contexto e trial sem execução |
| `TOOL_USING` | anterior + ferramentas permitidas e permissões reais |
| `EXECUTABLE` | anterior + leitura de cada executável, inputs, outputs, cleanup e dependency chain |
| `NETWORKED` | anterior + destinos, dados enviados, auth, telemetry, timeout e failure mode |
| `HOOK_INSTALLING` | gate forte + evento, frequência, fail mode, rollback e aprovação de scope |
| `CONFIG_MUTATING` | gate forte + arquivos/chaves, merge semantics, secrets e rollback |
| `DEPENDENCY_INSTALLING` | gate forte + pacote, versão, lifecycle scripts, lockfile, licença e supply chain |

`PURE_INSTRUCTION` usa `BASELINE`; `TOOL_USING`, `ELEVATED`; qualquer classe das
cinco linhas finais, `STRONG`. Hook/config/dependency sem isolamento e rollback
comprovados recebe `REJECT`, não trial privilegiado.

## Temporary trial

Preferência atual: `skills use` com CLI e source pinados. O comando gera prompt e
materializa a pasta da skill em diretório temporário; não cria instalação nem
lock de skill. Ele não é sandbox: o prompt continua não confiável e `--agent`
inicia um agent com esse prompt.

Protocolo mínimo:

1. snapshot de Git, `skills-lock.json`, skills/config/hooks project-scoped e
   paths globais relevantes;
2. cwd e npm cache descartáveis; telemetry desabilitada quando suportado;
3. `skills use <source-pin>` sem `--agent`;
4. medir prompt, inspecionar `SKILL.md` e support files; não executar scripts;
5. executar eval Wayper apenas se a classe e o isolamento permitirem;
6. remover `skills-use-*`, clone/cache do trial e qualquer side effect observado;
7. repetir snapshot e exigir diff esperado vazio fora da evidência do trial.

O CLI auditado mantém o diretório materializado para support files; cleanup
manual é obrigatório. Se a versão futura mudar esse comportamento, registre a
nova realidade em vez de criar wrapper próprio.

## Provenance e Capability Registry

[`external-skill-provenance.json`](external-skill-provenance.json) é ledger
Git-friendly, on-demand e inicialmente vazio. Cada promoção persistente identifica:

```text
SOURCE | REPOSITORY | SKILL_ID | REF_OR_VERSION | CONTENT_HASH_OR_LOCK_REF
INSTALLED_SCOPE | VETTED_AT | STATUS | RISK_CLASSES | DECISION
CAPABILITY_IDS | WAYPER_EVAL_RESULT
```

Quando `skills-lock.json` fornecer source/ref/hash confiáveis, o ledger usa
`LOCK_REF` e não duplica esses valores. Sem lock confiável, grava hash direto.
Capability externa promovida entra no registry como asset `SKILL` local com
`provenanceId`; registro `ACTIVE`/`PINNED` sem asset, ou asset sem provenance,
falha no validator. Trials não entram no Capability Registry.

Status corrente é `ACTIVE` ou `PINNED`. Revogação preserva histórico como
`DISABLED`, `DEPRECATED`, `REMOVED` ou `REPLACED`; `REPLACED` informa sucessor.

## Update e re-vetting

`latest` não significa trusted. Update persistente segue:

```text
CURRENT_REF -> NEW_REF -> DIFF -> RE-VET -> EVAL -> ACCEPT | REJECT
```

Mudança upstream material bloqueia promoção/uso persistente até novo vetting.
Não execute `skills update` automaticamente em assets Wayper. Aceite atualiza
lock/provenance/registry no mesmo change; rejeição mantém pin anterior.

## Revocation

Revogue quando surgir risco, abandono, conflito, routing regression, redundância,
custo sem ROI ou drift incompatível. Desabilite primeiro quando remoção imediata
quebrar consumers; remova asset e capability somente com evidência de consumers,
migração e rollback. Revogação global continua decisão do usuário.

## Token economy e limites

Policy, provenance e evals ficam on-demand. Nenhuma metadata de skill externa é
adicionada ao projeto até `USE_PROJECT`; biblioteca ampla não vira working set.
Discovery usa summaries compactos e evidence exata somente para finalistas.

Este contrato não implementa package manager, security scanner, runtime de
routing ou marketplace. O validator reproduz fixtures declarativas; task/source
e julgamento do agente continuam indispensáveis.
