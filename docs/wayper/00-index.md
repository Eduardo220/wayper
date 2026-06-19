# Wayper - Índice da documentação

Este diretório é a fonte de verdade da Wayper.

Tudo que define produto, regras de negócio, mecânicas de território, decisões técnicas, Firestore, GPS, ranking e evolução do app deve estar registrado em `docs/wayper`. Quando houver conflito entre uma ideia solta, uma conversa, um comentário de código ou um arquivo antigo de documentação, este diretório deve ser tratado como referência principal.

## Como usar esta documentação

- Leia este índice antes de mexer no projeto.
- Consulte os arquivos específicos antes de implementar qualquer feature.
- Registre decisões importantes em [[10-decisoes-do-projeto]].
- Registre propostas novas antes de transformar a ideia em implementação.
- Não assuma regras ausentes; documente a proposta e só então implemente.

## Documentos principais

- [[01-visao-geral]]: conceito, problema, público-alvo, diferencial e visão de produto.
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
