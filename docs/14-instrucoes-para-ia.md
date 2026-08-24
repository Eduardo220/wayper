# Instruções para IA no Projeto Wayper

> **Status:** vigente<br>
> **Tipo:** workflow operacional detalhado<br>
> **Escopo:** agentes de IA e fluxos assistidos<br>
> **Última revisão:** 2026-08-16<br>
> **Owner relacionado:** [`AGENTS.md`](../AGENTS.md)

`AGENTS.md` contém somente regras permanentes. Este documento explica como
aplicá-las; o catálogo e o roteamento de leitura pertencem a
[`docs/00-fontes-do-projeto.md`](00-fontes-do-projeto.md). Não replique esses
conteúdos em prompts, skills, agents ou hooks.

## Ownership do Harness

| Recurso | Responsabilidade |
| --- | --- |
| `AGENTS.md` | comportamento permanente e invariantes universais |
| `docs/` | estado, direção, decisões e explicações detalhadas |
| `docs/ai/memory/` | índice/topics técnicos hard-earned, somente sob demanda |
| `.agents/skills/` | workflow de domínio carregado sob demanda |
| `docs/ai/capability-registry.json` | inventário on-demand de capability → skill/reference |
| `DESIGN.md` | contrato visual; não duplica runtime tokens nem verdade de produto |
| `.codex/agents/` | especialização read-only com gatilho concreto |
| hooks | enforcement determinístico; não substituem documentação |
| `docs/ai/token-economy.md` | leitura/output/contexto sob demanda; não reduz reasoning ou evidence |

A arquitetura e as fronteiras project/global/generated estão em
[`docs/ai/harness-v1.md`](ai/harness-v1.md).
Classificação, flags e seleção mínima pertencem a
[`docs/ai/task-classification.md`](ai/task-classification.md) e
[`docs/ai/context-routing.md`](ai/context-routing.md); capability composition e
Context Closure pertencem a
[`docs/ai/capability-architecture.md`](ai/capability-architecture.md). Delegação, waves e síntese
pertencem a [`docs/ai/orchestration.md`](ai/orchestration.md). Gates/review
adaptativos pertencem a [`docs/ai/quality-gates.md`](ai/quality-gates.md). Metas
contínuas, autonomia e Human Decision Boundary pertencem a
[`docs/ai/meta-goal-runtime.md`](ai/meta-goal-runtime.md). Promotion, routing e
staleness de hard-earned learning pertencem a
[`docs/ai/memory-policy.md`](ai/memory-policy.md); memory nunca precede source,
testes ou decisão canônica. Modos de output, leitura progressiva e contabilidade
de contexto pertencem a
[`docs/ai/token-economy.md`](ai/token-economy.md).

## Context Gate

Antes de escrever, obtenha evidência suficiente para estes campos:

| Campo | Evidência mínima |
| --- | --- |
| Git | branch, `git status --short` e WIP relevante |
| Fontes | `AGENTS.md`, catálogo e leituras do domínio |
| Implementação | owners, consumidores, caminhos legados e alternativa existente |
| Testes | scripts e suítes reais relacionadas |
| Restrições | decisões e invariantes aplicáveis |
| Escopo | o que muda, o que não muda e autorização recebida |
| Validação | checks proporcionais ao risco |
| Rollback | reversão sem perda de dados ou compatibilidade |

Uma tarefa documental não exige carregar código alheio nem executar build sem
motivo proporcional. Um campo que não se aplica pode ser omitido com motivo.

## Descoberta progressiva

1. Leia `AGENTS.md` e o catálogo.
2. Classifique tarefa/flags, leia o diff e selecione gate/review proporcionais.
3. Leia os documentos mínimos e acione skill apenas quando o gatilho casar.
4. Localize headings/símbolos/callers e leia ranges suficientes antes de abrir
   arquivos grandes inteiros.
5. Use Graphify apenas para reduzir incerteza estrutural; confirme no source.
6. Leia implementação, callers, testes, configuração e bugs relevantes.
7. Acione especialista somente quando houver risco específico que justifique o
   contexto adicional.

Skills não decidem prioridade nem autorizam produto. Specialists não orquestram
outros agents nem substituem o agente principal; delegação é opt-in e segue o
protocolo de orchestration. Outputs derivados de Graphify, benchmarks e caches
são pistas reproduzíveis, nunca autoridade.

## Planejamento e execução

Cada fase explicita objetivo, critérios de aceite, arquivos previstos, riscos,
compatibilidade, testes, validações externas e rollback. Execute somente o
escopo autorizado:

- diagnóstico não autoriza correção;
- documentação não autoriza alteração de produção;
- feature restrita não autoriza refatoração ampla;
- WIP alheio é preservado;
- o caminho existente é consolidado antes de criar outro;
- alteração real atualiza seus testes e a fonte documental dona do assunto.

## Divergências

1. Descreva arquivos e evidências conflitantes.
2. Separe estado implementado de direção aprovada.
3. Classifique a fonte como estado, decisão, planejamento, operação, histórico
   ou hipótese.
4. Preserve compatibilidade até existir migração segura.
5. Atualize ou marque a fonte desatualizada sem apagar história útil.
6. Registre decisão importante no owner técnico apropriado.
7. Informe impacto, risco, validação e rollback.

Decisões aprovadas incompatíveis são bloqueio para decisão humana.

## Evidência e validação

- Não invente arquivo, serviço, teste, log, commit, deploy ou comportamento.
- Diferencie fato observado, inferência, hipótese e recomendação.
- Descubra comandos em `package.json`; não presuma lint ou typecheck.
- Use a menor validação suficiente e amplie conforme o risco.
- Para Markdown/config, valide diff, links, paths e sintaxe aplicável.
- Teste automatizado não prova GPS real, background, tela apagada ou aparelho
  físico. Registre comandos, resultados, falhas e itens não executados.

## Atualização documental

| Mudança | Owner principal |
| --- | --- |
| decisão técnica | `docs/08-decisoes-tecnicas.md` ou ADR de arquitetura |
| arquitetura/estado | `docs/04-arquitetura.md` e documento do domínio |
| regra de negócio | `docs/10-regras-de-negocio.md` e recorte de produto |
| bug/risco | `docs/13-bugs-conhecidos.md` |
| teste | `docs/12-guia-de-testes.md` e checklist físico aplicável |
| roadmap/backlog | `docs/02-roadmap.md` / `docs/03-backlog.md` |
| Harness | `docs/ai/harness-v1.md`; auditoria datada só como evidência |
| identidade/linguagem visual | `DESIGN.md`; valores executáveis em `src/theme/wayperTheme.js` |

Documento substituído mantém aviso e link para o sucessor. Caminhos persistidos
em docs versionadas são relativos ao repositório.

## Entrega

Informe diagnóstico, fontes, arquivos, decisões, recursos preservados/
consolidados/removidos, testes reais, divergências, riscos, rollback, commits e
próximo passo. Commit, push, deploy ou publicação exigem autorização da tarefa.
