# Auditoria Harness Wayper V2

> **Data:** 2026-09-09<br>
> **Status:** auditoria concluída; relatório materializado posteriormente<br>
> **Natureza:** snapshot de evidências e propostas, não normativo<br>
> **Escopo:** Harness mobile, recursos globais relevantes e integração com wayper-site<br>
> **Baseline mobile auditado:** `develop` / `2db95d40567564cf3bb6727096b81d448b1dd765` / CLEAN<br>
> **Owner normativo atual:** [Harness V1](../ai/harness-v1.md)

Este documento registra o relatório completo apresentado na conversa, sem
reexecutar a auditoria ou implementar suas recomendações. Source, configuração
e testes do baseline acima fundamentam as conclusões. A auditoria de
[2026-08-28](2026-08-28-auditoria-harness-large-agent-registry.md) é apenas
evidência histórica e não substitui esse baseline.

A janela auditada foi exclusivamente read-only e terminou sem alterações.
A criação deste Markdown foi autorizada depois, em solicitação separada, e é
a única mudança desta materialização. As declarações de worktree limpa,
fingerprints, validações executadas e segurança abaixo descrevem a janela
auditada, não o estado posterior à criação deste arquivo.

Os links são relativos ao repositório. Referências ao site pressupõem o checkout
irmão `wayper-site`; configuração global, arquivos ignorados e estado do host
são observações locais, não artefatos reproduzíveis apenas pelo commit mobile.
As propostas das seções 17–20 não constituem aprovação ou implementação.

## 1. VEREDITO

**PASS — auditoria read-only concluída.**

Isso significa que o levantamento e a verificação de integridade foram concluídos. **Não significa que o Harness atual tenha enforcement completo ou esteja pronto para autonomia V2.**

O sistema atual combina contratos operacionais detalhados, decisão do agente principal e helpers determinísticos com validação forte em algumas fronteiras. Ainda não existe um runtime executável que conecte todo o ciclo do Goal.

## 2. BASELINE

| Item | Inicial | Final |
| --- | --- | --- |
| Diretório | `.` | Idêntico |
| Branch | `develop` | `develop` |
| HEAD | `2db95d40567564cf3bb6727096b81d448b1dd765` | Idêntico |
| `git status --short` | Vazio | Vazio |
| `git diff` | Vazio | Vazio |
| `git diff --cached` | Vazio | Vazio |
| Worktree | CLEAN | CLEAN |

Fingerprint adicional, calculado somente em memória:

| Verificação mobile | SHA-256 inicial = final |
| --- | --- |
| Metadados da árvore, excluindo `.git` | `4e8121827c0a80edaf9a854c0b449342e6fdc8256d4d307de49c9ba11eea0626` |
| Conteúdo versionado e diretórios operacionais inspecionados | `1d1e8ac4f3d48f274c86481445bd9fb354e31f026057a3cb4754f8bedbe17cca` |
| Git index | `099f54669114341bfbd2fb6411233014760e3734fb3c382bafeb56deb498a216` |

Foram comparados metadados de **82.088 arquivos mobile** e **33.902 arquivos site**, além dos hashes de conteúdo selecionados.

O `wayper-site` já estava diferente do estado versionado: branch `dev`, HEAD `08e41ced27f17567cca1f16b6071b5f9c7af3179`, **1 modified e 189 untracked**. Esse estado preexistente também terminou exatamente igual.

## 3. EXECUTIVE SUMMARY

1. **O Meta Goal Runtime é declarativo.** Seus avaliadores executáveis são infraestrutura de testes/evals, não controladores conectados ao Goal nativo.
2. **A fronteira mais forte está em Context Map → Packet → Handoff:** schemas fechados, fingerprints, isolamento de repositório e validação de receipts existem.
3. **O router SELECTIVE está implementado e testado**, mas escolhe apenas profiles read-only em condições restritas. Não classifica livremente a intenção, constrói waves ou executa agentes.
4. **Não existe enforcement universal de dispatch.** O adapter valida seu próprio caminho; invocações externas permanecem fora dessa proteção.
5. **Completion continua sob decisão do agente principal.** O Stop hook não consulta os critérios reais do Goal, reviews ou findings pendentes.
6. **O Stop backstop tem lacunas verificadas:** worktree limpa resulta em `SKIP`; alterações isoladas no registry ou no corpus de packets recebem apenas verificações de diff.
7. **Evidência textual não equivale a prova:** o avaliador de completion aceita referências inventadas não vazias. `proveWorkingContext` também aceita texto com `FAIL` e marca o requisito como satisfeito.
8. **Working Context usa `threadId` como identidade operacional**, sem objetivo/versionamento de missão. Goals sucessivos na mesma thread podem herdar requisitos anteriores.
9. **Context Map existe e persiste**, mas ownership, atualização entre waves e promoção de evidência dependem do principal; não há lease ou compare-and-swap.
10. **Não existe feedback loop geral executável.** Há uma correção limitada de handoff; diagnóstico, reteste, rejeição e reabertura continuam majoritariamente em policy.
11. **Graphify mobile está stale** em HEAD e conteúdo. O graph site corresponde ao corpus local atual, embora esse checkout esteja dirty.
12. **Registry atual: 56 capabilities, 12 domains, 21 assets e 8 profiles.** Trinta capabilities têm profile; 26 não têm. Isso não justifica criar 26 novos agentes.
13. **Known-good não influencia a seleção como o score sugere:** a penalidade reduz o score exibido, mas não entra no cálculo marginal usado pelo seletor.
14. **Brain ativo não foi encontrado.** Repo memory tem índice vazio; Obsidian é uma interface sobre Markdown, sem pipeline automático de hidratação/promoção.
15. **Os testes provam contratos locais, não autonomia nem operação física.** A auditoria executou 42 testes unitários e verificações determinísticas; não executou aparelho, browser ou recuperação real de sessão.

## 4. SYSTEM MAP

Legenda: `D` determinístico; `LLM` julgamento do agente; `P` policy; `HOST` recurso externo ao projeto.

```text
USER REQUEST / alterações de instrução
              │
              ▼
[HOST] Goal nativo: create / get / complete / blocked
              │
              ▼
[LLM + P] TASK_MODE ou META_GOAL_MODE
          classe, riscos, constraints, critérios, S0–S3
              │
              ▼
[LLM] seleção das fontes e fechamento de contexto
   ├── docs / ADRs / skills
   ├── repo memory: índice vazio
   └── Graphify opcional → confirmação no source
              │
              ▼
[D, quando chamado] Working Context + Context Map
   fingerprints / evidências / known-good / gaps / deltas
              │
              ▼
[D] Router SELECTIVE
   ├── ROUTER_SELECTED: profile read-only elegível
   └── BEHAVIORAL_FALLBACK → decisão do principal
              │
              ▼
[D] Context Packet + preparePacketizedSpecialist
              │
              ▼
[LLM + HOST] spawn / execução / organização de waves
              │
              ▼
[D] consumePacketizedSpecialist
   ├── handoff válido → proposta de merge
   ├── inválido → no máximo uma correção
   └── falha → fallback bounded
              │
              ▼
[LLM] síntese / validação da nova evidência / merge
              │
              ▼
[LLM + P] diagnosticar → alterar → retestar → revisar
              │
              ▼
[D] testes/gates efetivamente escolhidos e executados
              │
              ▼
[LLM] decisão semântica de completion
   ├── [HOST] update_goal
   └── [HOOK] Stop: backstop técnico sobre a worktree
              │
              ▼
[P + LLM] candidatura a memória, sem promoção automática
```

### Transições do Goal

| Transição | Implementação atual | Enforcement e fallback | Autoridade |
| --- | --- | --- | --- |
| Request → Goal | Ferramentas nativas do host | Não há parser project-owned de intenção | Principal/host |
| Goal → classificação | `task-classification.md`, Meta Goal contract | Não há classificador executável de solicitações | LLM |
| Classificação → contexto | Skill e helpers `wayper-context*` | Helpers validam entradas; sua invocação depende do fluxo seguido | LLM + D |
| Contexto → routing | `routeTask` e registry | Validação determinística; residual retorna fallback | D, sobre fatos fornecidos |
| Routing → execução | Adapter + ferramenta nativa de spawn | Adapter não executa spawn nem intercepta todos os callers | LLM + host |
| Execução → validação | Scripts de qualidade, testes e handoffs | Cobertura depende dos checks escolhidos | LLM + D |
| Validação → completion | Decisão do principal; Stop técnico | Não há receipt global obrigatório de completion | LLM + host |

Fontes centrais: [harness-v1.md](../../docs/ai/harness-v1.md#L18), [orchestration.md](../../docs/ai/orchestration.md#L42) e [meta-goal-runtime.md](../../docs/ai/meta-goal-runtime.md).

### Meta Goal: estruturas e lifecycle

| Elemento | Estado observado |
| --- | --- |
| `GOAL` | Objetivo nativo no host; contrato detalhado formulado pelo principal |
| `CONSTRAINTS` | Policy/contexto; não há ledger fechado consumido por todos os executores |
| `AMENDMENTS` | Replanejamento textual; sem versão de amendment nem handler executável |
| `DECISIONS` | Registradas em síntese/estado selecionado; sem ledger geral de decisões |
| `EVIDENCE` | Estruturada no Map/handoff; também aceita como texto livre em outros contratos |
| `UNKNOWN` | Uncertainties/proof gaps documentados e parcialmente estruturados |
| `COMPLETION_CRITERIA` | Requisitos no Working Context e fixtures do avaliador; sem ligação obrigatória ao Goal host |
| Retry/resume | Continuação nativa e refresh explícito; sem coordenador persistido de retry |
| Cancellation | Interrupção do host; sem protocolo project-owned de cancelamento e fencing |
| Recovery | Releitura do Working Context; sem journal de tarefas/execuções recuperáveis |
| Reabertura | Decisão do principal/novo Goal; sem revogação executável de completion |

A documentação permite alterar somente a parte afetada por uma nova instrução, preservando slices válidos. **Isso é policy, não uma transição transacional implementada.**

## 5. CURRENT STATE MATRIX

`ENFORCED` abaixo significa enforcement **na fronteira indicada**, não em toda a sessão. `PROVEN` exige prova executada nesta auditoria e também tem escopo limitado.

| Componente | State | Impact | Freshness | Comportamento, limite e falha possível | Dependência / risco de migração |
| --- | --- | --- | --- | --- | --- |
| Goal nativo | IMPLEMENTED | HIGH | FRESH | Host mantém objetivo/status; projeto não controla seu lifecycle completo | API host; evitar runtime paralelo |
| Meta Goal contract | POLICY_ONLY | HIGH | FRESH | Contrato completo, execução pelo principal | Preservar semântica ao estruturar |
| Avaliador de completion | PROVEN | CRITICAL | FRESH | Casos declarativos passam; não autentica evidência nem controla Goal real | Receipts e integração; risco alto |
| Amendments | DOCUMENTED_ONLY | HIGH | N/A | Replanejamento parcial prescrito, sem revisionamento | Identidade do Goal |
| Working Context | IMPLEMENTED | HIGH | FRESH | Hash/reuse persistidos; invocação explícita | Compatibilidade dos arquivos existentes |
| Identidade por Goal | PARTIAL | HIGH | FRESH | `threadId`, sem objetivo/epoch; possível mistura de missões | Separar thread de execução |
| Prova do Working Context | PARTIAL | HIGH | FRESH | Texto com `FAIL` pode satisfazer requisito | Tipar evidência sem perder legado |
| Context Map | IMPLEMENTED | HIGH | FRESH | Estado compartilhado real; merge/ownership manuais | WC, registry e source |
| Invalidation do Map | ENFORCED | HIGH | FRESH | Revalida hashes quando chamado; não há watcher | Custo de hashes e escopo |
| Context Packet | PROVEN | HIGH | FRESH | Isolamento, schema e rejeição de stale comprovados | Map/registry |
| Router SELECTIVE | PROVEN | HIGH | FRESH | Seleção determinística restrita | Fatos classificados pelo LLM |
| Known-good no seletor | PARTIAL | MEDIUM | FRESH | Penalidade não chega ao cálculo marginal | Ajuste exige evals de seleção |
| Handoff | ENFORCED | HIGH | FRESH | Validação forte no adapter; execução externa pode escapar | Host/dispatch |
| Sandbox dos profiles | PARTIAL | HIGH | UNKNOWN | TOMLs/metadata read-only; isolamento real de cada child não exercitado | Capacidade exposta pelo host |
| Waves/DAG | POLICY_ONLY | HIGH | N/A | Principal decompõe, ordena e inicia | Não automatizar S3 antes de ownership |
| One-writer | POLICY_ONLY | HIGH | N/A | Sem lease/CAS/fencing executável | Concorrência de writers |
| Feedback geral | POLICY_ONLY | CRITICAL | N/A | Diagnóstico/reteste/review dependem do agente | Evidência + estado de tentativas |
| Correção de handoff | IMPLEMENTED | MEDIUM | FRESH | No máximo uma correção no adapter | Caller deve fornecer callback |
| FAST quality gate | PROVEN | HIGH | FRESH | Passou; não inclui toda a matriz de qualidade | Não tratá-lo como DEEP |
| Validação física | PARTIAL | CRITICAL | UNKNOWN | Runbooks e evidência histórica; sem prova atual | Aparelho/build/cenário |
| Stop backstop | PARTIAL | CRITICAL | UNKNOWN | Script real; host hook não foi exercitado end-to-end | Protocolo do host |
| Repo memory | PARTIAL | MEDIUM | FRESH | Índice schema v1, zero entries; promoção manual | Política e revisão |
| Brain histórico | MISSING | MEDIUM | N/A | Ausente do caminho ativo; arquivos apenas em backup | Não reativar por nostalgia |
| Obsidian | IMPLEMENTED | MEDIUM | UNKNOWN | Markdown/config local; sem integração executável por Goal | Docs/ADRs |
| Graphify mobile | IMPLEMENTED | HIGH | STALE | Índice isolado, mas não representa o baseline atual | Rebuild futuro autorizado |
| Graphify site | PROVEN | MEDIUM | FRESH | Validator de scope passou sobre o corpus local dirty | Baseline do site |
| Cache compartilhado de contexto | PARTIAL | MEDIUM | FRESH | Referências/dedup existem; não impede consultas duplicadas globais | Invocação do Map |
| Observabilidade | PARTIAL | HIGH | UNKNOWN | Proxies e receipts; atribuição incompleta | Host/eventos |
| Model routing | IMPLEMENTED | MEDIUM | FRESH | Regra determinística no adapter; execução não atestada universalmente | Disponibilidade de modelos |
| Cross-repo | PARTIAL | HIGH | FRESH | Contexto isolado funciona; seleção operacional permanece behavioral | Ownership do site |

## 6. GRAPHIFY

### Instalação e configuração

- Versão instalada: **Graphify 0.9.38**.
- Executável: `graphify`, apontando para instalação `uv` de `graphifyy`.
- CLI Codex observada: **0.153.4**.
- Graphs ativos separados em `wayper/graphify-out` e `wayper-site/graphify-out`.
- Configuração de escopo em `.graphifyignore` e `scope.json`.
- Nenhum hook Git ativo de rebuild/update foi encontrado.
- O graph misto antigo existe como `graph.mixed-deprecated.json`; não existe `../graphify-out/graph.json` ativo.

### Freshness e contagem

| Graph | HEAD registrado | Arquivos indexados | Nodes | Edges | Communities | Verificação atual |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Mobile | `279d60a…` | 350 | 4.034 | 11.108 | 0 | **STALE** |
| Site | `08e41ced…` | 144 | 606 | 1.401 | 0 | **PASS** |
| Misto aposentado | Histórico | 948 paths distintos | 7.307 | 15.535 | — | Não autoritativo |

Mobile:

- Corpus registrado: **370 arquivos**; corpus atual: **380**.
- Fingerprint registrado: `6eb0391c…`.
- Fingerprint atual: `b4670039…`.
- Graph SHA-256 continua `408f4573…`.
- O validator falha em `stale graph metadata: head`; a divergência de conteúdo também foi medida.
- Trinta paths do corpus atual não aparecem entre os sources indexados, incluindo **Context Map, Context Packet e Structured Handoff**.

Site:

- Corpus registrado e atual: **145 arquivos**.
- Fingerprint: `11062840…`, sem divergência.
- `package-lock.json` é o único arquivo desse corpus fora dos sources indexados.
- O resultado comprova correspondência com a **worktree local**, não que ela esteja commitada.

Fonte: [check-graph-scopes.mjs](../../scripts/quality/check-graph-scopes.mjs#L234).

### Scope dos paths

Classificação mutuamente exclusiva dos `source_file` distintos:

| Graph | Mobile | Site | Clones/worktrees | Backups | Generated | Outros |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mobile ativo | 350 | 0 | 0 | 0 | 0 | 0 |
| Site ativo | 0 | 144 | 0 | 0 | 0 | 0 |
| Misto aposentado | 392 | 170 | 168 | 213 | 3 | 2 |

A contagem “mobile” inclui dois arquivos `.obsidian/app.json`: o classificador atual aceita JSON como código. Portanto, `repository-code-only` não significa exclusivamente source funcional.

### Integração e caches

| Mecanismo | Existe? | Limite |
| --- | --- | --- |
| AST/stat cache | Sim | Otimização interna do Graphify |
| Memória de consultas | Sim: 5 Markdown no mobile | Não é repo memory |
| Reflections/learning | Sim | `LESSONS.md` e sidecar de aprendizado |
| Freshness de learning | Sim, por fingerprint de source | Dois nodes atuais: `contested` e `tentative`, ambos sem mudança no source |
| Query refs no Context Map | Sim | Validação/dedup quando registradas |
| Goal subgraph persistido | Não identificado | Map guarda referências, não subgraph executável |
| Domain subgraph persistido | Não identificado | Domínios do registry não geram subgraphs |
| Shared query result entre waves | Parcial | Principal precisa registrar e reutilizar |
| Proteção contra query duplicada | Parcial | Dedup de registros não impede executar a mesma query novamente |
| Query automática no router | Não | Router emite decisão, não consulta |
| Query automática ao iniciar Goal | Não | Skill/policy orientam o principal |
| Enforcement global de Graphify | Não | Validação existe nas fronteiras do Map e scope checker |

O Graphify é **opcional por policy**; pode tornar-se requisito de contexto quando a incerteza estrutural o justificar. Source e testes continuam sendo autoridade.

## 7. BRAIN / OBSIDIAN / KNOWLEDGE

### Brain e repo memory

O nome `wayper-brain` refere-se hoje a um conjunto **aposentado**, encontrado em backup. Não há pipeline ativo equivalente na raiz do workspace.

Repo memory atual:

- Storage: [docs/ai/memory/index.json](../../docs/ai/memory/index.json).
- Schema: `schemaVersion: 1`.
- Entries: **0**.
- Topics ativos: nenhum.
- Read path: consulta manual/on-demand orientada pela policy.
- Write path: promoção manual depois de síntese e validação.
- Authority: auxiliar; inferior a source, testes e decisões aprovadas.
- Freshness/invalidation: comparação conduzida pelo agente; sem validator automático de conteúdo da memória.
- Producer/consumer executáveis do índice: não identificados no fluxo do Harness.

| Pergunta | Resposta |
| --- | --- |
| A. Goal hidrata Brain automaticamente? | **Não.** Não há Brain ativo nem hidratação project-owned. |
| B. Agentes consultam Brain? | Não há caller ativo. Podem consultar repo memory conforme policy. |
| C. Findings podem virar memória? | Sim, como candidatura manual após síntese/validação. |
| D. Existe validação antes de persistir? | Existe checklist textual; não um gate executável obrigatório. |
| E. Memória stale é detectada? | Pela policy/agente. Graphify possui mecanismo separado de fingerprints. |

Há também memória **global do host Codex**, distinta dessas duas estruturas. A configuração atual tem `memories = true`, e esta sessão recebeu contexto de memória do host. A observação de agosto que registrava a feature desativada está histórica; não descreve a configuração atual. Isso não prova isolamento, promoção ou hidratação automática de repo memory.

Fonte: [memory-policy.md](../../docs/ai/memory-policy.md#L45).

### Obsidian e knowledge base

Foram encontrados dois conjuntos de configuração versionados:

- `docs/.obsidian/`;
- `docs/wayper/.obsidian/`.

O conteúdo é Markdown do próprio projeto. Existem configurações de busca, backlinks e graph do Obsidian; configuração de plugin habilitado não comprova serviço de sync operando.

| Conhecimento | Owner atual |
| --- | --- |
| Invariantes operacionais | `AGENTS.md` e documentos de domínio |
| Direção/intenção de produto | `docs/product/` |
| Decisões arquiteturais | ADRs e `docs/08-decisoes-tecnicas.md` |
| Runbooks | `docs/12-guia-de-testes.md`, `docs/22-teste-real-corrida-background.md` |
| Riscos conhecidos | Documentação de riscos e audits |
| História | Audits, changelog e revisões |

Lookup é por leitura/busca de arquivos, guiado por [docs/00-fontes-do-projeto.md](../../docs/00-fontes-do-projeto.md#L66). Não há conector Obsidian → Goal/Packet/Brain.

O Packet pode carregar **referências a evidências documentais** registradas no Map; não resolve automaticamente uma base de conhecimento.

### Duplicações e conflitos

- Docs, repo memory, memória global e Graphify memory são quatro canais diferentes, sem deduplicação compartilhada.
- Working Context antigo contém fatos históricos como router `SHADOW`; esses registros não foram automaticamente supersedidos.
- Auditorias de versões antigas do Codex coexistem com configuração atual diferente.
- Duas configurações Obsidian cobrem árvores documentais aninhadas.
- Não foi encontrado mecanismo automático de detecção de conflito entre esses canais.

Não foi necessário tratar a auditoria de 2026-08-28 como verdade atual.

## 8. CONTEXT

### Working Context

Implementação: [wayper-context.mjs](../../scripts/wayper-context.mjs#L182).

- Persistência: `.wayper-context/<goalId>.md`, JSON canônico embutido.
- CLI de refresh inicializa/revalida estado e Context Map.
- Fingerprints por arquivo ou range.
- Mesmo fingerprint + prova: `KNOWN_GOOD_UNCHANGED`.
- Sem prova: `REUSE_BEFORE_READ`.
- Mudança: `DIFF_BEFORE_FILE`, invalidando evidência anterior.
- Novo artefato: `READ_REQUIRED`.
- Escrita por arquivo temporário e rename.
- Sem lock, CAS, lease ou journal de recuperação.
- Nenhum refresh foi executado nesta auditoria.

Inventário observado: **6 Working Contexts**, dos quais **3 possuem Context Map**. Cinco retornam `STOP_WHEN_PROVEN` ao avaliar o estado armazenado; um possui 20 requisitos pendentes. Isso não equivale a revalidar suas provas contra o source atual.

### Identidade e prova

A skill orienta usar o `threadId` como `goal-id`. O refresh reutiliza o estado se esse identificador coincidir e acumula requisitos. Não há campo de objetivo ou revisão de missão.

Nesta mesma thread existia Working Context da missão anterior, com critérios de correção/commit, não da auditoria atual. Foi preservado, conforme a regra read-only.

Probe em memória:

```text
proveWorkingContext(..., evidence: "FAIL not validated")
→ requisito SATISFIED

Working Context legado com artefato e requisito assim “provados”
→ STOP_WHEN_PROVEN
```

Isso demonstra fraqueza do registro de prova. **Não demonstra que `STOP_WHEN_PROVEN` encerre o Goal nativo:** ele controla a decisão de expandir contexto, e não completion global.

### Budgets

| Classe | Teto de contexto, token proxy | Teto de brief legado |
| --- | ---: | ---: |
| TRIVIAL | 1.500 | 0 |
| BOUNDED | 4.000 | 0 |
| BUG | 8.000 | 800 |
| INVESTIGATION | 10.000 | 800 |
| ARCHITECTURAL | 16.000 | 1.200 |
| CRITICAL_RUNTIME | 24.000 | 1.600 |

Proxy: `ceil(bytes / 4)`, não tokenização nem faturamento real.

Packets aplicam divisores por target: profile `/4`, native e validation `/3`, capability set `/5`. Contexto opcional é removido primeiro; excesso obrigatório exige justificativa.

### Context Packet

Implementação: [wayper-context-packet.mjs](../../scripts/wayper-context-packet.mjs#L12).

Schema v1 fechado, com:

- identidade e fingerprint;
- target e objetivo;
- repositories e paths;
- capabilities requeridas/opcionais;
- riscos/invariantes;
- referências de evidência, dependência, validação, known-good e Graphify;
- gaps/ambiguidades;
- orçamento e métricas.

Targets: `agentProfile`, `nativeRole`, `capabilitySet`, `validationRole`.

Não transporta blobs de source, transcript, chain-of-thought ou graph bruto. Review independente exclui conclusões anteriores **marcadas como tal**; a classificação correta da evidência ainda depende de quem a registra.

**CP11:** a correção do baseline mudou a fixture para target nativo. O runtime mantém o contrato: native pode receber os dois repos; profile mobile fica restrito a `wayper`. O teste CP1b confirmou isso nesta auditoria. Os 20/20 evals anteriores não foram reexecutados porque criam arquivos/repositórios temporários.

### Context Map

Implementação: [wayper-context-map.mjs](../../scripts/wayper-context-map.mjs#L172).

Existe estado executável, não apenas documentação:

- Goal/task/repository state;
- fingerprints de registry, router e source;
- capabilities, riscos, invariantes;
- evidence, dependency edges, known-good;
- Graphify query refs;
- validation checks;
- learning delta, ambiguities e proof gaps.

Valida paths, symlinks, repos, hashes, referências e dados stale. Dependências são registradas após descoberta; não são inferidas automaticamente pelo registry.

Handoff gera proposta `UNVALIDATED` para o owner revisar. Não há store completo e executável de adjudicação de findings nem merge automático entre waves.

**REUSE_BEFORE_READ/DIFF_BEFORE_FILE:** helpers calculam estados; não interceptam ferramentas de leitura. O modelo pode ignorar a recomendação. O hash também exige leitura de bytes pelo processo, embora evite injetá-los no contexto do modelo.

## 9. ROUTING / CAPABILITIES / PROFILES

### Registry completo

Fonte: [capability-registry.json](../../docs/ai/capability-registry.json).

| Métrica | Quantidade |
| --- | ---: |
| Schema | 2 |
| Capabilities | 56 |
| Domains | 12 |
| Assets | 21 |
| Skills nos assets | 5 |
| References nos assets | 16 |
| Profiles | 8 |
| Capabilities com profile | 30 |
| Sem profile customizado | 26 |
| Capabilities compartilhadas entre profiles | 5 |
| Validators declarados nos profiles atuais | 0 |
| Prerequisites declarados nos profiles atuais | 0 |
| Conflicts declarados nos profiles atuais | 0 |
| Path matchers declarados nos profiles atuais | 0 |
| External skills promovidas | 0 |

O schema suporta mais metadata do que o catálogo preenche hoje. `suggests` representa dicas de fechamento de contexto, **não dependência executável de source**.

Legenda de profiles: `C` concurrency, `G` geospatial, `L` lifecycle, `P` persistence, `A` auth/security, `X` accessibility, `D` diagnostics/privacy, `R` progression/rules; `—` sem profile customizado.

| Domain | Todas as capabilities e candidates |
| --- | --- |
| RUN_RUNTIME — 5 | `active-run-lifecycle` C/L; `active-run-recovery` C/L/P; `active-run-notification` L; `live-gps-ingestion` G; `run-finish-handoff` L |
| MOBILE_SHELL — 4 | `app-bootstrap` —; `auth-session-gate` A; `root-navigation` —; `onboarding-permissions` L |
| PERSISTENCE_SYNC — 6 | `durable-run-save` C/P; `run-finalization` C/P; `deferred-post-run-processing` P; `run-sync-replay` C/P; `storage-migration` P; `local-profile-stats` R |
| TERRITORY_GEO — 4 | `route-geometry` G; `territory-capture` G; `territory-storage` G; `map-data-adaptation` G |
| FIREBASE_AUTH — 2 | `firebase-auth` A; `firestore-access` A |
| SOCIAL — 7 | `social-feed` —; `friends` —; `group-membership` —; `user-profile` —; `weekly-ranking` R; `monthly-ranking` R; `local-leader-ranking` R |
| PRODUCT_RULES — 3 | `xp-progression` R; `achievements-rewards` R; `product-rules` R |
| UI_DESIGN — 12 | `screen-ui-accessibility` X; `design-system` —; `layout` —; `typography` —; `color` —; `motion` —; `accessibility` X; `native-ui` —; `map-ui` —; `gamification-ui` —; `post-run-design` —; `design-audit` — |
| DIAGNOSTICS_SENTRY — 2 | `local-diagnostics` D; `sentry-monitoring` D |
| ANDROID_NATIVE — 1 | `android-run-boundary` L |
| TEST_BUILD — 1 | `test-build` — |
| HARNESS_AI — 9 | `harness-routing`, `quality-gates`, `goal-runtime`, `high-signal-memory`, `completion-backstop`, `token-economy`, `context-efficiency`, `skill-architecture`, `external-skill-acquisition`: todos — |

Capabilities sem specialist continuam podendo usar main/native roles e assets. Ausência de custom profile não é ausência de atendimento.

### Paths, testes e dependências

Não existe associação completa capability → paths → tests → validation depth no registry. O vínculo atual é feito pelas skills, documentação de routing e descoberta do source.

| Família | Owners/source e testes encontrados | Dependências/riscos relevantes |
| --- | --- | --- |
| Active-run/GPS | `src/services/runTracking/`, `src/tasks/`, hooks de corrida; testes lifecycle/tracking/reconciler | GPS, background, ownership, notification |
| Recovery/finalização | `src/services/run/`, repositories e storage; testes finalization/recovery/queues | Save mínimo, falhas, replay, idempotência |
| Shell/permissions | `App.js`, navigation, auth/onboarding/permissions | Inicialização, identidade, native boundary |
| Territory/map | `src/services/territory/`, tracking e MapLibre; testes geometry/capture/storage | Coordenadas, geometria, dados do mapa |
| Auth/Firestore | Auth service, Firebase config e consumidores | Trust boundary; cobertura de regras remotas não demonstrada |
| Social/progression | Repositories, ranking e XP; testes de ranking/profile/achievements | Regra aprovada versus mecânica de storage |
| UI/accessibility | Screens/components/theme e projeções | Semântica, foco, acessibilidade real |
| Diagnostics | Diagnostics/monitoring e seus testes | Redaction, export, privacidade, fail-open |
| Android | Kotlin em `android/.../run/` | Build, tasks, notification actions, aparelho |
| Harness | `scripts/wayper-*`, `scripts/quality/` | Schemas, receipts, contexto, routing |

### Profiles e agentes

Todos os oito profiles são **reviewers/specialists read-only**, repo `wayper`, `writePermission: none`, handoff v1 e política comum de model/reasoning.

| Profile | Implementação | Trigger principal | Skills explícitas | Exclusão importante |
| --- | --- | --- | --- | --- |
| `wayper_concurrency_reviewer` | TOML | CONCURRENCY | active-run + persistence-sync | Race hipotética/fluxo sequencial |
| `wayper_geospatial_reviewer` | TOML | GPS_GEO, TERRITORY_GEO | active-run + territory-map | Styling/layout sem transformação |
| `wayper_mobile_lifecycle_reviewer` | TOML | LIFECYCLE, NATIVE_ANDROID | active-run + mobile-shell | UI sem lifecycle/native boundary |
| `wayper_persistence_reviewer` | TOML | OFFLINE_STORAGE, SYNC, DATA_MIGRATION | persistence-sync | Trabalho storage-neutral |
| `wayper_auth_security_reviewer` | `nativeRole: explorer` | AUTH_SECURITY, FIREBASE | Nenhuma declarada | Mera menção a Firebase/auth |
| `wayper_accessibility_reviewer` | `nativeRole: explorer` | ACCESSIBILITY | Nenhuma declarada | Mudança apenas visual/copy |
| `wayper_diagnostics_privacy_reviewer` | `nativeRole: explorer` | PRIVACY | Nenhuma declarada | Usar diagnóstico apenas como evidência |
| `wayper_progression_rules_reviewer` | `nativeRole: explorer` | PRODUCT_RULE | Nenhuma declarada | Regra nova/não aprovada/conflitante |

Os quatro TOMLs declaram sandbox read-only e proíbem editar/delegar. Para profiles nativos, `readOnly` é metadata/instrução do adapter; a ferramenta exposta não possui parâmetro de sandbox equivalente. **O isolamento efetivo de children não foi exercitado nesta auditoria.**

Outros recursos:

- Roles nativas disponíveis: `default`, `explorer`, `worker`.
- Main pode exercer architect/adjudicator/tester; não há profiles dedicados para esses papéis.
- Não há writer customizado no registry.
- No workspace pai existe `wayper_web_performance_reviewer.toml`, read-only, e duas skills site: design/content e motion/WebGL.
- Esses recursos do pai não estão no registry mobile nem nas pastas `.codex`/`.agents` do site.
- O profile web não estava exposto como agent type customizado nesta sessão.

Overlaps reais: lifecycle, recovery, durable-save, finalization e sync-replay. São perspectivas parcialmente complementares, mas a necessidade de múltiplas reviews ainda depende do principal.

### Router SELECTIVE

Fonte: [wayper-agent-router.mjs](../../scripts/wayper-agent-router.mjs#L435).

**DETERMINISTIC**

- Normalização de fatos e paths repo-scoped.
- Validação de capabilities/profiles/proveniência.
- Coverage, exclusões, conflitos e prerequisites declarados.
- Seleção greedy por cobertura marginal.
- Identidade/fingerprint e receipt.
- Fallback quando condições operacionais não são satisfeitas.
- Integração do resultado ao Context Map.

Pesos principais: required `1000`, optional `180`, risk `80`, path `60`, domain `40`, subdomain `50`, keyword `25`; desconto de overlap e proxy de custo.

**MODEL_JUDGMENT**

- Classificar a solicitação e os riscos reais.
- Declarar assessment completo.
- Determinar capabilities necessárias e fechamento de dependências.
- Escolher S0–S3.
- Decidir se delegar compensa o custo.
- Fazer Graphify/source discovery.
- Interpretar finding, validar evidência e decidir completion.

`ROUTER_SELECTED` exige S1/S2 read-only, um repo, classe não architectural/critical-runtime, coverage completa e ausência de residual estrutural/ambiguidade/conflito relevante. Uma flag crítica pode elevar o modelo do specialist sem que o router mude a classe da task.

`SHADOW` significava recomendação sem autoridade operacional. `SELECTIVE` autoriza somente a escolha do profile elegível, após o Decision Gate. Os nomes “shadow” de evals/logs não significam que o runtime atual voltou a SHADOW.

**Finding comprovado:** com known-good, o profile observado manteve `marginalScore=992`, enquanto o score exibido caiu de `992` para `912`. A penalidade não entra em `selectProfiles`.

Operações já mecânicas que não precisam ser recalculadas pelo LLM: coverage, exclusões, score, custo estimado, dedup e schema checks. O problema principal é garantir o uso dos resultados, não criar outro seletor.

### Model/reasoning

| Condição no adapter | Modelo | Reasoning |
| --- | --- | --- |
| TRIVIAL sem risco/capability crítica | `gpt-5.6-luna` | medium |
| BOUNDED não crítico | `gpt-5.6-terra` | medium |
| BUG/INVESTIGATION não crítico | `gpt-5.6-terra` | high |
| Risco/capability crítica ou classe ARCHITECTURAL/CRITICAL_RUNTIME | `gpt-5.6-sol` | high |

Configuração global observada do principal: `gpt-6-astra`, `xhigh`. TOMLs não fixam modelo/reasoning.

`PRIVACY`, `ACCESSIBILITY` e `PRODUCT_RULE` não estão no conjunto de flags que elevam automaticamente para `sol/high`. Isso é uma propriedade atual, não prova isolada de erro: falta benchmark de adequação por tarefa.

Não há roteamento adaptativo por resultado observado, custo real ou degradação do modelo.

## 10. EXECUTION / HANDOFF

### Execução e waves

| Mecanismo | Estado atual |
| --- | --- |
| Slots | Quatro totais nesta sessão, incluindo main |
| S0 | Default; main investiga/executa/valida |
| S1 | Um specialist read-only auxilia |
| S2 | Leituras/reviews independentes em paralelo |
| S3 | Writers nativos, somente após elegibilidade por policy |
| Construção de DAG/waves | Principal |
| Prerequisites | Router resolve metadata declarada; catálogo atual não declara prerequisites |
| One-writer | Policy por arquivo/wave |
| Leases/fencing | Não identificados |
| Worktrees | Opcionais, criação manual/autorizada; não automáticas |
| Prevenção de conflitos | Escopo conhecido, DAG e coordenação humana/LLM |
| Child spawning | Policy `max_depth=1`; receipt exige zero descendentes |
| Termination | Ferramentas do host e decisão do principal |
| Crash/recovery de waves | Sem journal executável |

Fonte: [orchestration.md](../../docs/ai/orchestration.md#L67).

### Structured Handoff

Fonte: [wayper-structured-handoff.mjs](../../scripts/wayper-structured-handoff.mjs#L19).

Schema v1 com:

- Goal/task/agent/packet identity;
- `DONE`, `NO_FINDINGS`, `PARTIAL`, `BLOCKED`, `INVALID_INPUT`;
- coverage checked/missing;
- findings com cenário, impacto, safeguard, confiança e evidência;
- evidência nova, files read/changed, testes;
- risks, proof gaps, ambiguities, blockers e recommendations;
- budget e métricas.

O adapter valida receipt, modelo/reasoning, `forkTurns=none`, read-only, zero descendentes e correspondência com Packet/Map/registry.

Nova evidência vira proposta `UNVALIDATED`, com `CONTEXT_MAP_OWNER_REVIEW_REQUIRED`. Recommendations não são um scheduler tipado de próximos profiles.

**Handoff inválido bloqueia aceitação no adapter**, podendo gerar uma correção e depois fallback bounded. Ele não bloqueia universalmente a ferramenta de execução nem a finalização do Goal.

`DONE` no handoff significa término daquela tarefa de análise, não ausência global de findings ou aprovação do produto.

## 11. FEEDBACK LOOP

| Etapa | Mecanismo real | Limitação |
| --- | --- | --- |
| FAIL detectado | Exit code, gate result, handoff/test status | Nem todos os resultados viram estado compartilhado |
| DIAGNOSE | Policy de classificação de falha | Julgamento do principal |
| CHANGE | Edição autorizada por main/worker | Sem vínculo obrigatório com failure ID |
| RETEST | Comandos escolhidos pelo principal | Sem receipt universal ligado ao diff |
| REVIEW | Specialist/native review conforme risco | Rejeição não move state machine |
| RETRY | Uma correção de handoff; policy de retry transitório | Não há retry budget geral executável |
| Same-failure detection | Não identificado | Pode repetir diagnóstico/ação sem progresso |
| Progress detection | Não identificado no projeto | Critério textual/host |
| Root-cause reassessment | Prescrito | Não disparado mecanicamente |
| Reopen Goal | Decisão do principal/host | Sem revogação ligada a nova evidência |
| Human escalation | Policy para blocker/conflito de decisão | Sem evento/limiar persistido |

O campo `retry` do backstop contém **um comando recomendado**, não uma execução automática de retry.

No site, Playwright tem `retries: 2` em CI e `0` local. Isso é retry de teste, **não um feedback loop de engenharia**.

O gap prioritário não é “continuar até passar”; é registrar:

```text
falha identificável
→ hipótese de causa
→ ação correspondente
→ nova baseline
→ reteste comparável
→ aceitação ou rejeição
```

Hoje essa cadeia depende do principal.

## 12. VALIDATION

### Executado nesta auditoria

| Validação | Resultado |
| --- | --- |
| Router unitários | 25/25 PASS |
| Router evals, incluídos no teste | 18/18 PASS |
| Context Packet unitários | 5/5 PASS, incluindo CP1b cross-repo |
| Meta Goal unitários | 12/12 PASS |
| Meta Goal cases | 54/54: 20 completion, 12 shadow, 22 budget |
| Capability routing | 13/13 PASS |
| External skill acquisition | 13/13 PASS |
| Quality gate | PASS |
| Lint no gate | 0 erros; 277 warnings; 0 novos |
| Size/architecture/router/diff no gate | PASS |
| Graph scope mobile | STALE — finding confirmado |
| Graph scope site | PASS |
| Probes de fronteira | Gaps de prova, Stop e known-good reproduzidos |

São **42 testes unitários únicos**. O quality gate reexecutou os 25 do router; eles não foram contados novamente.

Não executei evals que criam fixtures persistentes/temporárias ou repositórios Git. Os resultados anteriores de packets **20/20**, handoffs **20/20** e conjunto pré-commit **105 testes** permanecem evidência anterior, não execução desta auditoria.

### Inventário

- Mobile: **62 arquivos de testes em `src`**.
- Harness: **13 arquivos de testes em `scripts`**.
- Site: **17 arquivos unitários e 5 arquivos E2E**.
- Não foi encontrado workflow GitHub Actions versionado nem hook Git ativo de qualidade.
- Mobile não possui typecheck canônico no package.
- FAST gate não executa full Jest, aparelho, packet evals, handoff evals ou graph freshness.

Fonte: [check-quality-gate.mjs](../../scripts/quality/check-quality-gate.mjs#L230).

### Matriz L0–L6

| Nível | Evidência existente | O que realmente prova |
| --- | --- | --- |
| L0 STATIC | ESLint, size, architecture, schema/evals determinísticos, diff | Estrutura e regras verificadas; não execução do produto |
| L1 UNIT | Jest mobile, Node Harness, Vitest site | Contratos isolados; frequentemente com mocks |
| L2 INTEGRATION | `activeRunLocalFirst.integration`, queues/storage; componentes site | Integração no ambiente de teste, não SO/aparelho |
| L3 RUNTIME | Playwright site; fluxos mobile via dev client/emulador | Comportamento do runtime exercitado |
| L4 PLATFORM | Build Kotlin/Gradle/Expo; browser/config platform | Compilação e compatibilidade da superfície testada |
| L5 PHYSICAL DEVICE | Runbook Android; script CDP físico do site | Somente execução real com identidade do aparelho/build |
| L6 REAL SCENARIO | Corrida externa, offline/background, bateria, GPS real | Resultado no cenário físico executado |

### Capabilities críticas e profundidade necessária

| Área | Evidência necessária conforme mudança | Gap atual |
| --- | --- | --- |
| MapScreen lifecycle | L1–L3; L5 quando houver reentrada/native | Teste de hook não prova todo lifecycle do SO |
| Active-run/concurrency | L1–L2 com interleavings; L3/L5 quando cruzar runtime | Não há matriz executável que imponha profundidade |
| Offline persistence/recovery | L1–L2 com falhas; L3/L5 para kill/storage real | Mock não prova durabilidade física |
| GPS/background | L1 para filtros; L3–L6 para entrega de localização | Testes verdes não comprovam tela apagada/GPS real |
| Territory | L1–L2 geometry/storage; L3 visual/dados; L6 captura real | Geometria correta não prova render/percepção |
| Permissions/notifications | L1 + L3–L5 por plataforma | Sistema operacional é parte do contrato |
| Android nativo | L4 e L5; L6 para corrida | Build não prova foreground service/recovery |
| iOS | L4/L5 específicos quando em escopo | Não houve evidência atual suficiente de pipeline/teste nativo |
| Auth/security | L1–L2 e ambiente real/regras remotas pertinentes | Não foi demonstrado gate completo de regras Firestore |
| Site WebGL | L1–L3, browser/GPU e L5 mobile | Emulação de viewport não é aparelho físico |

O runbook Android mantém uma reprovação histórica e reteste parcial; não autoriza afirmar regressão atual nem aprovação atual. [Teste real de background](../../docs/22-teste-real-corrida-background.md#L22).

O site possui casos reais de context loss, fallback, reduced-motion e cleanup. Seu script “physical Android” conecta a um endpoint CDP e mede comportamento, mas não constitui sozinho atestação da identidade física do endpoint. [three.spec.ts](../../../wayper-site/tests/e2e/three.spec.ts) e [verify-physical-android.mjs](../../../wayper-site/scripts/verify-physical-android.mjs).

## 13. POLICY VS ENFORCEMENT

| Mechanism | Policy | Implementation | Enforcement | Test | State |
| --- | --- | --- | --- | --- | --- |
| Working Context | Obrigatório em Goal nativo | CLI/Markdown | Apenas quando chamado | Context tests/benchmarks | IMPLEMENTED |
| Graphify | Opcional; por incerteza | Graphs + validators | Scope/Map, não leitura global | Scope atual site PASS/mobile stale | PARTIAL |
| Brain | Aposentado | Backup somente | Nenhum ativo | — | MISSING |
| Repo memory | Seletiva, pós-validação | Índice vazio | Checklist manual | Sem promoção executável | PARTIAL |
| Obsidian | Interface documental | Markdown/config | Nenhum gate de Goal | Inspeção local | IMPLEMENTED |
| Context Packet | Default no dispatch Harness | Builder/schema | Adapter | 5 testes atuais | PROVEN |
| Context Map | Shared Goal state | Estado embutido no WC | Validator quando chamado | Evals existentes | IMPLEMENTED |
| Routing | SELECTIVE restrito | Router/receipt | Dentro do router/adapter | 25 + 18 atuais | PROVEN |
| One-writer | Um writer por arquivo/wave | Coordenação | Sem lease/CAS | Sem prova de exclusão real | POLICY_ONLY |
| DIFF_BEFORE_FILE | Ler delta primeiro | Status calculado | Não intercepta leitura | Testes de contexto existentes | PARTIAL |
| REUSE_BEFORE_READ | Reutilizar antes de reler | Fingerprint/prova | Não intercepta leitura | Testes de contexto existentes | PARTIAL |
| STOP_WHEN_PROVEN | Parar expansão de contexto | Predicate | Não encerra Goal | Probe mostrou prova textual fraca | PARTIAL |
| Handoff schema | Retorno fechado | Validator | Adapter rejeita inválido | Testes/evals existentes | ENFORCED |
| Required reviewer | Matriz por risco | Seleção/documentação | Sem gate universal | Routing tests | POLICY_ONLY |
| Required tests | Matriz por escopo | Scripts dispersos | Parcial no Stop/FAST | Gate atual PASS | PARTIAL |
| Validation depth | Q0–Q3 e requisitos físicos | Policy/eval | Sem binding automático ao Goal | Evals declarativos | POLICY_ONLY |
| Unresolved findings | Devem bloquear quando materiais | Campos no handoff/Map | Sem ledger global de adjudicação | Schema local | PARTIAL |
| Completion | Evidence-gated | Eval + decisão do principal | Não conectado ao Goal host | 54 cases; probe de evidência fraca | PARTIAL |
| Memory updates | Synthesis → validation → promotion | Manual | Não há promotion gate executável | — | POLICY_ONLY |
| Model/reasoning | Policy por risco/capability | Resolver | Receipt do adapter | Testes existentes | IMPLEMENTED |
| Child spawning | Depth 1 | Instruções/receipt | Não universal no host | Guard estático | PARTIAL |
| Cross-repo | Repos isolados | Map/Packet/graph | Scope validado; routing fallback | CP1b/router atuais | PARTIAL |
| Feedback | Diagnosticar e retestar | Correção de handoff + policy | Só correção limitada | Handoff tests existentes | PARTIAL |
| Recovery | Reutilizar estado válido | WC persistido | Sem retomada transacional de tarefas | Fingerprint tests | PARTIAL |

## 14. COMPLETION

**Quem controla DONE hoje: o agente principal, usando o host.**

Há três coisas distintas:

1. `STOP_WHEN_PROVEN`: decisão de parar expansão de contexto.
2. `DONE` de handoff: término de uma tarefa delegada.
3. Completion do Goal: decisão semântica final do principal.

### O que bloqueia

- Packet/Map/handoff inválidos podem bloquear seus adapters.
- Testes e gates podem retornar FAIL.
- Na primeira execução pertinente, o Stop hook pode emitir `decision: block`.

### O que não está conectado

O Stop hook não lê:

- success criteria reais do Goal;
- evidence ledger completo;
- test receipts ligados à baseline;
- review verdicts globais;
- findings não resolvidos;
- evidência de aparelho/runtime;
- estado de amendments.

Probes:

| Entrada | Resultado atual |
| --- | --- |
| Worktree sem mudanças | Plano vazio |
| Apenas `capability-registry.json` alterado | Checks de untracked/diff, sem capability validator |
| Apenas `context-packet-evals.json` alterado | Checks de untracked/diff |
| Falha com `stop_hook_active=true` | Resposta vazia; evita ciclo de Stop |
| Completion fixture com evidências substituídas por strings inventadas | `GOAL_SATISFIED` |

Fonte: [check-completion-backstop.mjs](../../scripts/quality/check-completion-backstop.mjs#L102) e [check-meta-goal-completion.mjs](../../scripts/quality/check-meta-goal-completion.mjs#L279).

O avaliador aceita uncertainty MATERIAL aberta se houver tratamento/impacto, e pode aceitar contabilização explicitamente UNKNOWN/UNAVAILABLE. Isso é razoável para unknowns não bloqueadores, mas a classificação continua sendo uma afirmação fornecida ao avaliador.

Não há revogação automática de completion quando uma prova envelhece ou uma review posterior rejeita o resultado.

## 15. OBSERVABILITY / TOKEN ECONOMY

| Dado | Medição atual | Limite |
| --- | --- | --- |
| Profiles selecionados | Router output/receipt | Log opcional, sem trilha obrigatória global |
| Agents spawned | Eventos do host/Pixel Agents | Não consolidados no Context Map |
| Graphify queries | Saved results/stamp e query refs | Registro opcional; sem accounting global |
| Arquivos lidos | Declaração do handoff | Não equivale a interceptação das ferramentas |
| Leituras duplicadas | Dedup de refs e proxies | Não mede todas as releituras reais |
| Context size | Bytes e `bytes/4` | Não mede tokens reais de prompt completo |
| Token usage | Agregado do host quando disponível | Atribuição por etapa/agent limitada |
| Tool calls | Host/eventos externos | Sem schema de custo/evidência do Harness |
| Retries | Correções do adapter; retries do runner | Sem ledger geral |
| Tests | Saída de comandos e autorrelato | Sem receipt comum ligado à baseline |
| Intervenções humanas | Conversação | Sem classificação/contagem normalizada |
| Completion | Goal host e relatos | Sem receipt independente de admissibilidade |

O hook global `SubagentStop` observado pertence ao **Pixel Agents**, não ao validator de handoffs do Wayper. A telemetria detalhada desse hook é opt-in.

Gaps que impedem otimização confiável:

- comparar “packet pequeno” com custo total incluindo contexto herdado, skills e resposta;
- distinguir referência evitada de leitura realmente evitada;
- atribuir custo de discovery, review, retries e correções;
- medir falsa completion e false findings;
- conhecer overhead real dos profiles nativos, que não possuem skills/TOML contabilizados como os quatro originais.

O host reportou ao encerrar este Goal `tokensUsed=251939` e `timeUsedSeconds=783` — **13min03s no contador do host**. São agregados reportados, não custo faturado nem atribuição por ferramenta/etapa.

## 16. GAP ANALYSIS

| Component | Current | Target | Gap | Impact | Dependency | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Goal identity | Thread ID reutilizado | Execução/revisão inequívoca | Mistura entre missões | HIGH | Contrato de Goal | P0 |
| Evidence | Hashes + textos autorrelatados | Evidência tipada ligada à baseline | `FAIL`/texto inventado pode “provar” | CRITICAL | Identidade/baseline | P0 |
| Completion | Principal + Stop técnico | Admissibilidade verificável | DONE sem cadeia de evidência obrigatória | CRITICAL | Evidence/validation | P0 |
| Feedback | Policy | Tentativas limitadas e comparáveis | Sem same-failure/progress detection | CRITICAL | Evidence + task state | P0 |
| Validation depth | Matriz documental | Plano executável por risco | FAST confundível com prova suficiente | CRITICAL | Capability/risk mapping | P0 |
| Graph mobile | Stale | Índice isolado verificável | Owners atuais ausentes | HIGH | Baseline/corpus | P1 |
| Context reuse | Helpers opcionais | Reuse integrado ao fluxo | Leituras/queries repetidas | HIGH | Goal version + telemetry | P1 |
| Dispatch | Adapter invocado pelo LLM | Fronteira canônica observável | Bypass externo e receipts autorrelatados | HIGH | Host capabilities | P1 |
| Map ownership | Rename sem CAS | Single-owner verificável | Lost update em concorrência | HIGH | Execution state | P1 |
| Router cost/known-good | Proxies e score divergente | Seleção coerente e medida | Economia não chega à decisão | MEDIUM | Evals/telemetry | P1 |
| Cross-repo | Contexto isolado, seleção behavioral | Ownership explícito | Site fora do catálogo operacional | HIGH | Baseline/site contracts | P2 |
| Memory | Manual e vazia | Promoção seletiva validada | Sem dedup/freshness compartilhados | MEDIUM | Completion/evidence | P2 |

## 17. TARGET HARNESS V2

Proposta incremental: **manter os componentes atuais e conectar suas fronteiras**, sem criar Brain monolítico, novo router, daemon ou árvore de agentes.

```text
USER
  │
  ▼
META GOAL
[LLM] intenção, critérios, constraints, unknowns
[D] goalRunId + revision + amendments explícitos
  │
  ▼
BASELINE
[D] repo identities + HEAD + dirty/content fingerprints
  │
  ▼
KNOWLEDGE
[LLM] seleção de docs/ADRs/memória relevante
[D] provenance + freshness dos itens selecionados
  │
  ▼
GRAPH
[D] validade do índice + cache key por corpus/query
[LLM] necessidade da consulta e interpretação
  │
  ▼
CONTEXT
[D] Working Context/Map/Packet existentes
[LLM] significado e suficiência da evidência
  │
  ▼
ROUTER
[D] SELECTIVE existente
[LLM] Decision Gate e residual explícito
  │
  ▼
EXECUTION
[D] task/attempt identity, preconditions, receipts
[LLM + HOST] execução e julgamento
  │
  ├──────────────► FEEDBACK
  │                [D] falha, tentativa, budget, progresso
  │                [LLM] causa, correção, replanejamento
  │                         │
  ◄─────────────────────────┘
  │
  ▼
VALIDATION
[D] plano requerido + receipts vinculados à baseline
[LLM] avaliação semântica e necessidade de L3–L6
  │
  ▼
COMPLETION
[D] admissibilidade, stale checks, unresolved blockers
[LLM] decisão final justificada
[HOST] concluir somente pelo caminho suportado
  │
  ▼
MEMORY UPDATE
[LLM] candidato realmente reutilizável
[D] dedup/provenance/schema/freshness
[HUMAN/POLICY] promoção conforme autorização
```

Princípios:

- Persistir no mecanismo existente sempre que possível.
- Separar **validade estrutural**, **prova executada** e **julgamento semântico**.
- Não usar hashes como substitutos de autenticidade ou correctness.
- Manter S0 como default e S3 fechado até ownership demonstrável.
- Não declarar enforcement de host quando só houver policy.
- Registrar `UNKNOWN` em vez de fabricar accounting ou cobertura física.
- Não tornar Graphify obrigatório quando source direto já resolve a tarefa.

## 18. MIGRATION PLAN

| Fase | Objetivo e módulos prováveis | Dependencies | Risco | Testes necessários | Rollback | Exit criteria |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Identidade/baseline | Versionar execução do Goal em `wayper-context.mjs`, Map, skill e contrato Meta Goal | Nenhuma | Médio: compatibilidade WC | Dois Goals na mesma thread; amendment parcial; resume; troca de baseline | Leitor compatível, novos campos opcionais inicialmente | Missões distintas não herdam critérios silenciosamente |
| 2. Evidence receipts | Tipar source/test/command/runtime evidence; revisar `prove`, Map e handoff | Fase 1 | Alto: critérios antigos | FAIL não satisfaz; receipt stale/replay; command não executado; source alterado | Manter legado como `UNVERIFIED`, não apagar | Prova material possui origem e baseline verificáveis |
| 3. Validation plan | Associar risco/capability aos checks e profundidade; integrar quality/Stop | Fase 2 | Alto: falso bloqueio | Registry-only, packet-evals-only, native, device pending, NA justificado | Modo report-only inicial | Nenhum caminho relevante perde check obrigatório |
| 4. Completion boundary | Conectar admissibilidade ao fluxo suportado do host | Fases 1–3 | Alto: loop/bypass | Clean worktree com Goal aberto; commit após testes; finding pendente; hook repetido | Desativar integração, preservar relatório de gaps | DONE rejeitado quando requisito material está sem prova |
| 5. Feedback | Estado mínimo de attempts/failure/progress no fluxo existente | Fases 1–3 | Médio/alto | Falha repetida, transitória, nova causa, review rejection, cancel/resume | Retornar a execução manual mantendo ledger | Retry limitado e ausência de progresso geram reavaliação/escalation |
| 6. Graph/context economy | Atualização autorizada do graph e cache/ref reuse por fingerprint | Fase 1 | Médio: cache stale | Corpus alterado; query repetida; repo diferente; custo/prova preservados | Source direto; invalidar cache | Reuse reduz trabalho sem reutilizar contexto inválido |
| 7. Dispatch/ownership | Receipts de execução e owner checks; CAS antes de ampliar writers | Fases 1, 2, 5 | Alto: concorrência | Bypass, replay, writer simultâneo, lost update, child inesperado | S0/S2; S3 desabilitado | Limites verificáveis ou explicitamente não suportados |
| 8. Cross-repo/memory | Ownership site e promoção seletiva de memória | Fases anteriores relevantes | Médio | Repo leakage, site dirty, docs conflitantes, memória stale/duplicada | Behavioral routing e memória manual | Contexto/prova isolados e promoção rastreável |

Nada dessa migração foi implementado.

## 19. EVAL PLAN

### Casos reais

| Caso | Falha/variante a exercitar | Evidência esperada |
| --- | --- | --- |
| MapScreen lifecycle | Resultado tardio após unmount/reentry | Owner correto, regression, sem falso finding |
| Active-run | Transição inválida/duplicada | Estado e invariantes preservados |
| Concurrency | Single-flight, stale callback, disputa de owner | Interleavings explícitos e review independente |
| Offline persistence | Falha de chunk/index/save; replay | Save mínimo e recuperação sem perda |
| GPS | Outlier, pausa, gap, duplicata, baixa precisão | Métrica/segmentos corretos + cenário real quando necessário |
| Background tracking | Screen-off, notification, kill/reentry | Prova física identificada, sem substituir por Jest |
| Territory | Geometria inválida, captura, migração | Invariantes geo/storage e visual pertinente |
| Permissions | Negação/revogação/background | Estado seguro e plataforma correta |
| Auth/security | Identidade/acesso/Firestore boundary | Teste apropriado e limites de cobertura explícitos |
| Deeplink | Navegação com auth e estado ativo | Routing/context closure sem contaminar active-run |
| Mobile performance | Trabalho pesado em GPS/render | Medição real, não inferência por tamanho de arquivo |
| Site WebGL | Context loss, reduced-motion, cleanup, GPU fraca | Browser e aparelho distinguidos |

Adicionar variantes transversais:

- Goal alterado no meio;
- mesmo thread, novo objetivo;
- graph stale;
- receipt de outro Goal;
- reviewer rejeita;
- teste passa em baseline anterior;
- falha repetida sem progresso;
- cross-repo com site dirty;
- contexto incompleto marcado como completo;
- ausência de aparelho;
- handoff inválido e fallback.

### Método

Comparar baseline V1 e candidato V2 sobre as mesmas tasks, com ground truth revisado e ambiente identificado. Separar:

1. replay determinístico;
2. execução de agente em ambiente isolado autorizado;
3. runtime/plataforma;
4. aparelho/cenário real.

### Métricas

| Métrica | Definição necessária |
| --- | --- |
| Autonomous goal completion | Critérios realmente satisfeitos sem intervenção, não apenas status DONE |
| Human intervention | Quantidade e motivo: esclarecimento, correção, autorização, blocker externo |
| Routing precision/recall | Profiles/capabilities úteis versus necessários no ground truth |
| Duplicate discovery | Repetição de consulta/leitura sem mudança de baseline |
| Context reuse | Reuse válido, invalidation correta e descoberta evitada |
| False findings | Findings rejeitados com evidência |
| False completion | DONE com critério/prova obrigatória ausente |
| Tokens | Input/output/cache, quando suportados; UNKNOWN separado |
| Tool calls | Por fase e por finalidade |
| Retries | Tentativas e repetição da mesma falha |
| Total cost | Custo real disponível + tempo; nunca proxy de bytes apresentado como cobrança |

Critérios de aprovação: **zero falsa completion nos casos de segurança**, nenhuma perda de isolamento, nenhuma substituição de prova física por mocks, e economia de contexto sem reduzir recall/qualidade.

## 20. TOP 10 NEXT ACTIONS

1. Versionar identidade do Goal e baseline, separando execução de `threadId`.
2. Impedir que texto `FAIL` ou evidência não verificada satisfaça requisitos.
3. Criar receipts de validação vinculados ao estado realmente testado.
4. Corrigir a seleção de checks do backstop, incluindo alterações isoladas de registry/evals.
5. Conectar completion aos requisitos, receipts e findings pendentes pelo caminho suportado do host.
6. Implementar feedback limitado com failure identity, attempt budget e progress detection.
7. Atualizar o graph mobile **somente em missão autorizada**, preservando isolamento por repo.
8. Medir reuse real e corrigir a divergência entre score e seleção known-good.
9. Provar dispatch/ownership antes de ampliar autonomia ou paralelismo de escrita.
10. Executar o benchmark V1×V2 e só então expandir cross-repo ou promoção automática de memória.

## 21. SAFETY

Confirmado para a janela de auditoria, anterior à criação deste documento:

- **Nenhuma alteração realizada** no projeto ou no site.
- **Nenhum commit** criado nesta auditoria.
- **Nenhum push**, pull, fetch, merge, rebase ou troca de branch.
- **Nenhum arquivo persistente criado pela auditoria**; fingerprints e probes ficaram em memória.
- Nenhuma alteração no Git index.
- Nenhum refresh de Working Context, Graphify, Brain ou Obsidian.
- Nenhum formatter, autofix, install ou implementação.
- **Baseline final idêntico ao inicial**, incluindo hashes da árvore operacional e index.
- O estado dirty preexistente do site foi integralmente preservado.


### Registro da materialização

- Documento criado após a auditoria, a pedido do usuário.
- Somente este Markdown foi adicionado; nenhum código, teste, configuração,
  Graphify, Working Context, memória ou arquivo do site foi alterado.
- Nenhum teste da auditoria foi reexecutado para produzir este registro.
- Validação documental: estrutura das 21 seções, links locais, whitespace e
  conferência de que somente este arquivo aparece na worktree.
- Nenhum staging, commit ou push realizado.
