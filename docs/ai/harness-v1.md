# Wayper AI Harness V1

> **Status:** vigente<br>
> **Escopo:** repositório mobile<br>
> **Versão:** Foundation + Task Routing V1, 2026-08-16<br>
> **Decisão relacionada:** `docs/08-decisoes-tecnicas.md`<br>
> **Inventário de origem:**
> [`docs/audits/2026-08-16-ai-harness-v1-foundation.md`](../audits/2026-08-16-ai-harness-v1-foundation.md)

## Fonte de verdade

O único owner operacional do mobile é [`AGENTS.md`](../../AGENTS.md). Ele aponta
para o catálogo de fontes; não replica estratégia, workflows de domínio ou
configuração de ferramentas.

```text
AGENTS.md
  -> task class + risk flags
     -> context map mínimo
        -> docs/00-fontes-do-projeto.md + skill sob demanda
        -> source, callers e testes atuais
           -> especialista read-only quando houver risco concreto
              -> ferramentas e hooks
                 -> outputs generated, nunca autoridade
```

[`docs/14-instrucoes-para-ia.md`](../14-instrucoes-para-ia.md) é o workflow
detalhado. Este arquivo possui arquitetura e ownership; auditorias são apenas
evidência datada.

## Recursos project-scoped

- `docs/ai/task-classification.md` e `docs/ai/context-routing.md`: decisão
  declarativa sob demanda; não existe processo/router executável.
- `docs/ai/routing-evals.md`: contrato positivo e negativo sem API externa.
- `.agents/skills/`: quatro rotas de contexto do mobile. Apenas `name` e
  `description` entram na descoberta; o corpo é carregado quando o domínio casar.
- `.codex/agents/`: quatro revisores especializados, todos read-only e sem modelo
  fixado pelo projeto.
- Não há `.codex/config.toml` do projeto: a fundação não precisa sobrescrever a
  configuração do usuário para funcionar.
- Não há hook Codex versionado: nenhum enforcement adicional foi provado
  necessário nesta unidade.

Papéis genéricos de descoberta, implementação, segurança e revisão usam
capacidades nativas do Codex. Agents project-scoped existem somente para
concorrência, lifecycle mobile, persistência e geoespacial.

## Fronteiras

| Escopo | Owner | Conteúdo permitido |
| --- | --- | --- |
| `MOBILE_PROJECT` | este repositório | regras, skills e especialistas específicos do app |
| `SHARED_WAYPER` | workspace pai | somente conhecimento realmente comum entre repositórios |
| `USER_GLOBAL` | configuração do usuário | RTK, plugins, preferências, credenciais e ferramenta Graphify genérica |
| `GENERATED_RUNTIME` | ferramenta produtora | graph, cache, maps, benchmarks, logs e hooks instalados |
| `DEPRECATED` | backup externo | Brain/router, agentes genéricos e snapshots substituídos |

Secrets, tokens, preferências de modelo e paths pessoais não são versionados.
Site skills e o revisor WebGL pertencem ao site e não ao mobile.

## Graphify, RTK e hooks

Graphify é um índice auxiliar ativo. Sua configuração e ciclo de geração não
mudam nesta fundação; `graphify-out`, maps e caches nunca entram no contexto
permanente nem substituem source. Toda pista material é confirmada diretamente.

RTK é ferramenta global opcional. O projeto não inclui adapter, proxy ou segundo
sistema de compressão e deve continuar operável com shell comum.

Os hooks Git `post-commit` e `post-checkout` instalados pelo Graphify são runtime
local, assíncrono e fail-open. O hook Codex/RTK e hooks de plugins são configuração
do usuário. Nenhum deles é fonte de regras do mobile.

## Progressive disclosure

1. carregar `AGENTS.md` e metadata de descoberta;
2. classificar tarefa, flags e menor context level;
3. selecionar domínios, catálogo/docs e skills mínimas;
4. confirmar código, callers e testes;
5. subir contexto, Graphify ou especialista somente por evidência.

Não existe ciclo `AGENTS -> docs -> skill -> AGENTS`: skills referenciam owners,
mas não redefinem política nem roteiam agentes.

## Fora da V1

Ainda não foram implementados quality/process workflows das skills, review
multi-agent completo, knowledge graph novo, memory system, token proxy, regras
ESLint ou limite de tamanho de arquivo. `wayper-brain` permanece somente no
backup histórico; conceitos úteis foram classificados em
[`docs/ai/task-classification.md`](task-classification.md), sem reativar código,
agent ou configuração.
