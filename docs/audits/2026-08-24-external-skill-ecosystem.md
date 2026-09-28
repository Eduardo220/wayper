# Auditoria — External Skill Ecosystem

> **Data observada:** 2026-08-24  
> **Tipo:** evidência datada; não substitui a policy  
> **Policy:** [`../ai/external-skill-acquisition.md`](../ai/external-skill-acquisition.md)

## Provenance observada

| Item | Evidência |
| --- | --- |
| Repositório | `https://github.com/vercel-labs/skills.git` |
| Ref | tag `v1.5.23`, commit `435076e78988e1e6ec40d00b0b1d76bdbbc5419a` |
| npm | `skills@1.5.23`; `latest=1.5.23`; `gitHead` igual ao commit acima |
| npm integrity | `sha512-+hMNBSi35yfX0sKD+ZcRm9y5or7u313OdkcvrRvJAsAzGCaA8wRTu2OmVdN0KRbk9ybqKby5dijkn6OVvNTUmw==` |
| Runtime | Node `>=22.20.0`; dependencies `tar@^7.5.20` e `yaml@^2.8.3` |
| Find Skills | tree `76a98a285cb0434f3d39e1a873823556330e398b`; SHA-256 do `SKILL.md` `c00eeea0e13e74fe4a9d84ba0a8542205a1b736d65f13134fe1a6647eb14976f` |

Fontes primárias: [repo/README](https://github.com/vercel-labs/skills/blob/v1.5.23/README.md),
[Find Skills](https://github.com/vercel-labs/skills/blob/v1.5.23/skills/find-skills/SKILL.md)
e [OpenAI Build skills](https://learn.chatgpt.com/docs/build-skills).

## Skills CLI real

`npx --yes skills@1.5.23 --help` confirmou `add`, `use`, `remove`, `list`,
`find`, `update`, `experimental_install`, `init` e `experimental_sync`.

| Capability | Comportamento observado/confirmado no source da ref |
| --- | --- |
| `find` | consulta `https://skills.sh/api/search`, limite 20, aceita `--owner`, ordena por installs e envia query/result count à telemetry salvo opt-out |
| `add` | default project; copia pasta inteira para canonical `.agents/skills`, cria links quando necessário e grava lock; `--copy` evita links |
| `use` | resolve como `add`, materializa em `skills-use-*` e imprime prompt; `--agent codex` inicia `codex` com o prompt |
| `list` | project por default; `-g` global; `--json` fornece path, scope, agents e source do lock |
| `update` | seleciona project/global, compara lock/hash e busca versão upstream; não fornece trust ou re-vetting semântico |
| `remove` | project por default; `-g` global; remove canonical/links e atualiza lock |

Project lock `skills-lock.json` v1 guarda source, URL/ref, `skillPath` e SHA-256
computado da pasta. Global lock `~/.agents/.skill-lock.json` v3 guarda source,
URL/ref, `skillPath`, GitHub tree SHA e timestamps. Esses locks ajudam
provenance/update, mas não registram vetting, arquitetura ou decisão Wayper.

O source usa `.agents/skills` como canonical project/global. `codex` possui
project path `.agents/skills` e é tratado como universal, então o global
observado também ficou em `~/.agents/skills`. A tabela do README que indica
`~/.codex/skills` para Codex diverge desse source e do comportamento observado;
source/ref e filesystem prevalecem. OpenAI Docs confirma que Codex atual lê
skills de usuário em `$HOME/.agents/skills` e repo skills em `.agents/skills`.

## Side effects e trust boundary

O CLI usa rede para npm, Git/GitHub, skills.sh, audit API e telemetry. Telemetry
pode ser desativada por `DISABLE_TELEMETRY` ou `DO_NOT_TRACK`. O package não
declara `preinstall`, `install` ou `postinstall`; `prepare: husky` pertence ao
workflow do próprio repositório.

O installer copia arquivos da pasta selecionada, inclusive scripts, references,
assets ou config local da skill; exclui metadata própria, `.git` e caches Python.
Não foi observado registro automático de hooks/config Wayper. Ainda assim,
`SKILL.md` pode instruir o agent a executar scripts, acessar rede/ambiente ou
mutar config com permissões do agent. O próprio CLI alerta que skills rodam com
permissões completas do agent. `use --agent` também não é sandbox.

Audit/security API, installs, stars e publisher continuam sinais. A audit API é
fail-open e não bloqueia instalação quando indisponível.

## Find Skills

Metadata observada: `363 B` para `name + description + absolute path`; body
`5.472 B`. Triggers incluem perguntas amplas como “how do I do X”, “can you do
X” e desejo genérico de capability. Não há negative triggers declarados.

O workflow recomenda leaderboard antes da query e usa install count, source
reputation e stars como filtros. Também diz para não recomendar apenas pelo
search result; ao prosseguir, recomenda `add -g -y`. Ele não conhece
`CAPABILITY_GAP`, Context Closure, arquitetura ou Router Wayper. Overlap é alto;
instalação project-scoped criaria routing ambiguity e custo permanente.

`TOKEN_COST=UNKNOWN`: o runtime não expôs tokens por skill. Os valores 363 B e
5.472 B são bytes observados e não foram convertidos em tokens.

Estado observado: Find Skills já existia em `USER_GLOBAL`,
`/home/eduardo/.agents/skills/find-skills`, com conteúdo/hash iguais ao upstream
pinado e registro no global lock. Wayper não o instalou, não o atualizou e não o
removeu. `npx skills list --json` no trial retornou zero project skills.

Decisão: `CLI_ONLY` para Wayper. A presença global é configuração do usuário,
subordinada às regras project-native; não vira capability promovida no registry.

## Discovery e temporary trial

Query estreita executada com telemetry desabilitada:

```text
npx --yes skills@1.5.23 find "find skills" --owner vercel-labs
```

O CLI retornou 20 resultados ordenados por installs. Find Skills apareceu
primeiro, mas popularidade não foi usada como trust proof. Somente esse candidato
foi inspecionado porque era oficial, `PURE_INSTRUCTION` e alvo explícito da
unidade.

Trial pinado:

```text
npx --yes skills@1.5.23 use \
  https://github.com/vercel-labs/skills/tree/v1.5.23/skills/find-skills
```

Resultado: prompt de `5.615 B`; nenhum supporting file além de `SKILL.md`; sem
execução via `--agent`. Duas execuções de medição criaram
`/tmp/skills-use-ft1a9Z` e `/tmp/skills-use-9Zo5Fw`, cada uma com o `SKILL.md` de
`5.472 B`. O CLI não removeu os diretórios; cleanup manual removeu ambos.

Antes/depois, os SHA-256 de `package.json`, `package-lock.json`, Find Skills
global e global skill lock permaneceram iguais. `git status` ficou limpo, nenhum
`skills-lock.json`, skill, hook, config ou dependency apareceu no projeto e não
restou `skills-use-*`. Cache npm e clone da auditoria ficaram restritos ao root
descartável `/tmp/wayper-skills-audit.pzNt1d`, removido após coleta.

## Limites observados

- `use` é temporary materialization, não isolamento de execução;
- o CLI não fornece diff/re-vet/Wayper eval automático;
- lock/hash detecta mudança de conteúdo, não confiança;
- `find` retorna até 20 candidatos e pode aspirar contexto se o Harness não
  limitar query, shortlist e inspeção;
- comportamento upstream pode mudar; qualquer versão nova exige nova auditoria.
