# Wayper - Índice da documentação

> **Status:** vigente como índice temático; conteúdo misto técnico e histórico<br>
> **Tipo:** índice complementar<br>
> **Escopo:** documentos em `docs/wayper/`<br>
> **Última revisão:** 2026-08-01<br>
> **Fonte principal relacionada:** [`docs/00-fontes-do-projeto.md`](../00-fontes-do-projeto.md)

Este diretório preserva documentação detalhada e histórica da Wayper. Ele não
precede o comportamento real da branch `develop` nem a direção normativa em
[`docs/product/direcao-estrategica-completa.md`](../product/direcao-estrategica-completa.md).

A hierarquia vigente está em `../00-fontes-do-projeto.md` e distingue duas
perguntas: código, testes, configuração e evidência em `develop` mostram o estado
atual; a direção estratégica, decisões aprovadas e ADRs aceitas orientam a
evolução. `main` é apenas referência estável. Em conflito, a divergência deve ser
registrada e a fonte desatualizada corrigida ou marcada.

## Como usar esta documentação

- Leia este índice quando a matriz de fontes encaminhar a tarefa para
  `docs/wayper/`; ele não integra sozinho o núcleo permanente.
- Leia antes `../../AGENTS.md`, `../00-fontes-do-projeto.md`,
  `../product/direcao-estrategica-completa.md` e `../../README.md`.
- Consulte os arquivos específicos antes de implementar qualquer feature.
- Registre decisões importantes em [[10-decisoes-do-projeto]].
- Registre propostas novas antes de transformar a ideia em implementação.
- Não assuma regras ausentes; documente a proposta e só então implemente.

## Documentos principais

- [[01-visao-geral]]: conceito, problema, público-alvo, diferencial e visão de produto.
- `../product/00-visao-oficial.md`: visão normativa vigente.
- [[02-mvp]]: escopo inicial, itens fora do MVP, critérios de sucesso e riscos.
- [[03-mecanica-territorios]]: regras de conquista de territórios com GPS real.
- [[04-regras-corrida]]: início, pausa, retomada e encerramento de caminhada ou corrida.
- [[05-gps-e-validacao]]: precisão, pontos inválidos, sinal, fraude, bateria e segundo plano.
- [[06-xp-nivel-ranking]]: regras iniciais para XP, níveis e ranking.
- [[07-telas-e-fluxos]]: telas principais e fluxos esperados do app.
- [[08-firebase-firestore]]: proposta inicial de modelagem no Firestore.
- [[09-arquitetura-tecnica]]: arquitetura provável do app e separação de responsabilidades.
- [[10-decisoes-do-projeto]]: decisões aprovadas, pendentes e rejeitadas.
- [[11-prompts-para-ia]]: prompts úteis para Codex, Claude e GPT.
- [[12-ideias-futuras]]: ideias fora do MVP para evolução do produto.
- [[13-problemas-conhecidos]]: riscos técnicos e problemas conhecidos.
- [[14-glossario]]: termos usados na documentação e no produto.
- [[15-checklist-validacao-corrida-ativa]]: roteiro de validacao fisica para corrida ativa, background, tela bloqueada, notificacao, recovery e finalizacao.
- `../13-bugs-conhecidos.md`: bugs, riscos e itens que exigem teste real.
- `../14-instrucoes-para-ia.md`: protocolo operacional, incluindo "Obsidian como mente do projeto".
- `../16-ideias-de-melhoria.md`: ideias aguardando avaliacao do Eduardo.
- `../17-propostas-pendentes.md`: propostas que precisam de decisao antes de implementacao.
- `../23-onboarding-permissoes-estados-vazios.md`: politica atual de onboarding, permissoes, estados vazios, offline e checklist manual.
- `../24-resumo-rodada-local-first.md`: resumo operacional da rodada local-first consolidada em 2026-06-19.

## Regra de atualização

Toda mudança relevante no comportamento do app deve atualizar a documentação correspondente:

- Mudança de território: atualize [[03-mecanica-territorios]].
- Mudança em atividade, corrida ou caminhada: atualize [[04-regras-corrida]].
- Mudança em GPS ou validação: atualize [[05-gps-e-validacao]].
- Mudança em XP, nível ou ranking: atualize [[06-xp-nivel-ranking]].
- Mudança em telas ou fluxo: atualize [[07-telas-e-fluxos]].
- Mudança em Firestore: atualize [[08-firebase-firestore]] e registre decisão em [[10-decisoes-do-projeto]].
- Mudança arquitetural: atualize [[09-arquitetura-tecnica]] e [[10-decisoes-do-projeto]].
- Mudanca que afete local-first, fontes de verdade, storages, sync, diagnostico ou instrucoes para IA: atualize tambem `../24-resumo-rodada-local-first.md` quando o resumo ficar defasado.
- Mudanca relevante deve consultar bugs, ideias, propostas pendentes e ideias futuras antes de implementar, e registrar novas oportunidades sem executa-las automaticamente.
- Eduardo aprova, rejeita ou adia propostas; IA/Codex apenas sugere, registra e organiza.
