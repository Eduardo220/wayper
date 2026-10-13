# XP, nível e ranking

## Objetivo

XP, nível e ranking devem aumentar motivação sem tornar o MVP complexo. A primeira versão precisa ser fácil de explicar, barata de calcular e resistente a erros básicos de GPS.

## XP no MVP

Regra inicial implementada local-first:

- XP principal por distancia valida.
- Bonus pequeno por territorio real em corrida por zonas.
- Bonus pequeno por concluir atividade valida.
- Bonus pequeno de primeira corrida.
- Nenhum bônus por velocidade no MVP.

Essa regra evita incentivar comportamento perigoso ou fraude por velocidade.

## Formula inicial

Fonte de verdade local:

- Progresso agregado: `wayper_user_progress_v1`.
- Eventos auditaveis: `wayper_xp_events_v1`.
- Conquistas desbloqueadas: `wayper_achievements_v1`.
- Progresso parcial de conquistas: `wayper_achievement_progress_v1`.

Regra aplicada por `ProgressionRepository`:

- 5 XP por atividade valida concluida.
- 1 XP a cada 100 m completos, equivalente a 10 XP por km.
- 1 XP a cada 10 min completos.
- +10 XP na primeira corrida valida.
- +5 XP para corrida valida no modo zonas.
- XP territorial em corrida por zonas: `floor(areaM2 / 100) + 2 XP por celula capturada`, limitado a 500 XP por corrida.

Os valores ainda podem ser balanceados apos testes reais, mas ja sao regra oficial local da etapa atual.

## Atividade válida para XP

Uma atividade deve gerar XP somente se:

- Foi finalizada pelo usuário.
- Possui distância válida acima do mínimo definido.
- Possui duração compatível com caminhada ou corrida.
- Não foi marcada como claramente suspeita.
- Foi salva localmente como corrida finalizada.
- Nao esta em `RUNNING`, `PAUSED`, `RECOVERING` ou `FINISHING`.

Atividades com problemas parciais podem gerar XP reduzido no futuro. Para o MVP, a regra deve ser binária sempre que possível.

Limites atuais:

- Distancia minima para XP: 100 m.
- Duracao minima para XP: 60 s.
- Corrida livre nao recebe XP territorial.
- Corrida por zonas recebe XP territorial somente com area/captura/celulas validas.

## Idempotencia

- Cada evento de XP usa ID deterministico `xp:{userId}:{runId}:{type}`.
- O progresso guarda `processedRunIds` e `processedRunEventTypes`.
- Reabrir o app, recalcular de `runs` ou retry de sync nao deve duplicar XP.
- Conquistas desbloqueadas sao deduplicadas por `userId + id`.
- Firestore nao participa do caminho critico; sync remoto de XP/conquistas fica para etapa futura.

## Níveis

O nível do usuário deve ser derivado do XP total.

Regra inicial sugerida:

- Nível 1: 0 XP.
- Nível 2: 100 XP.
- Nível 3: 250 XP.
- Nível 4: 500 XP.
- Nível 5: 900 XP.

Após o MVP, a curva pode ser ajustada. O importante é que o nível não dependa de cálculos ocultos difíceis de migrar.

Apos o nivel 5, o delta entre niveis cresce por fator 1.55. A formula fica centralizada em `ProgressionRepository.getLevelInfo()`.

## Conquistas iniciais

Catalogo local inicial:

- `first_run_completed`: primeira corrida valida.
- `total_distance_1k`: 1 km acumulado.
- `total_distance_5k`: 5 km acumulados.
- `total_distance_10k`: 10 km acumulados.
- `first_zone_run`: primeira corrida por zonas.
- `first_territory_capture`: primeira area conquistada.
- `completed_runs_3`: 3 corridas validas.
- `total_duration_30min`: 30 minutos totais em movimento.

Conquistas dependem apenas de metricas locais reais. Nao dependem de amigos, grupos, ranking global ou Firestore.

## Sync futuro

O sync remoto completo de XP/conquistas ainda nao foi implementado. A estrutura local ja guarda `remoteId`, `syncStatus`, `offlineStatus`, `lastSyncAttemptAt`, `lastSyncedAt`, `syncError` e `schemaVersion`.

Estrategia futura:

- Enviar eventos de XP por `localId/sourceRunId/type`.
- Enviar conquistas desbloqueadas por `userId + achievementId`.
- Mesclar remoto/local por identidade deterministica.
- Nunca recalcular destrutivamente sobre o progresso local sem backup/migracao explicita.

## Ranking

Ranking completo fica fora do MVP, mas o app pode preparar dados para ranking futuro.

Ranking inicial, se existir, deve ser simples:

- XP total.
- Distância válida total.
- Quantidade de atividades concluídas.
- Território conquistado, se a métrica estiver estável.

Ranking não deve definir posse competitiva de território no MVP.

Regra local-first atual:

- `RankingRepository` sempre retorna `source`: `remote`, `cache`, `local`, `empty` ou `demo`.
- `remote` vem do service remoto de ranking e pode alimentar cache local.
- `cache` vem de `wayper:rankingCache:v1:*`, deve carregar `updatedAt`/`cachedAt` e nao e ranking remoto atual.
- `local` usa dados reais locais do proprio usuario e leaderboards territoriais locais quando existirem.
- Ranking local por XP usa `ProgressionRepository`; por distancia/corridas usa `RunRepository`; por area/territorio usa `TerritoryRepository`.
- Se so houver o usuario local, o ranking pode mostrar esse estado limitado, sem inventar adversarios.
- Se nao houver dado real suficiente para o criterio/periodo, o retorno deve ser `empty`.
- `demo` so pode aparecer por opt-in explicito em ambiente dev e nunca como fallback silencioso de erro remoto.

### Tela principal do Ranking — Fase 1

- A tela principal usa uma seleção única: `mode` (`km`/`zones`), `scope` (`global`/`regional`) e `period` (`monthly`/`allTime`). O padrão é KM, Global, Mensal.
- `km` consulta `distance`; `zones` consulta a área territorial existente (`area`). Global e Regional usam o `RankingRepository`; Regional usa a cidade real do perfil. Sem cidade, a tela declara o ranking regional indisponível e não consulta Global como substituto.
- O resumo e a posição usam a mesma seleção. A lista remota tem limite de 300 perfis; a quantidade e a posição exibidas se referem apenas aos atletas carregados com valor positivo para a métrica. Cache e dado apenas local mostram a métrica, mas não alegam posição atual competitiva.
- O cache mensal é separado por mês. A tela identifica cache e dados locais; documento remoto sem `rankingMonth` atual ou sem campo mensal explícito não entra na classificação mensal. Dados locais mensais vêm de corridas finalizadas no mês atual.
- A tela principal não grava novos previews de posição/medalha: o limite de perfis consultados não prova classificação global. Os campos históricos e a métrica permanecem, pendentes de uma fonte de posição confiável na Fase 2.
- Na Fase 2 visual, `VER RANKING` abre a classificação completa no fluxo da própria tela. Ela reaproveita a seleção e a lista reais da Fase 1, mostra até 300 atletas carregados e mantém a posição pessoal como indisponível sem fonte autoritativa. O Android Back e o botão de voltar retornam à Home do Ranking.
- Home e lista detalhada usam o mesmo preview visual somente em `__DEV__` e quando a seleção real retorna vazia. O fixture fica em `src/screens/ranking/__fixtures__/`, não passa por repository/cache/backend e nunca se mistura a atletas reais. A prévia é marcada na UI e pode usar Santa Maria, RS e posições fictícias apenas no ambiente DEV.
- Cada linha da classificação abre `PlayerProfile` pelo `playerId`; a pilha do Ranking preserva seleção e scroll ao voltar. O perfil competitivo lê um único documento público agregado por ID. A linha local usa apenas um pequeno snapshot dos agregados reais já calculados pelo Ranking; sem essa linha, o próprio atleta pode ler os agregados locais persistidos, sem varrer histórico na abertura. Dados ausentes ficam indisponíveis, não viram zero. A prévia de perfil é restrita a IDs de fixture e `__DEV__`, sem escrita remota. Conquistas ficam em estado vazio até existir contrato público agregado; a métrica de retomadas exige um contador com essa semântica explícita.
- Líderes locais, retomada, regiões, XP, corridas e área continuam no domínio e nos serviços existentes, fora dos controles principais da tela.

## Cuidados

- Não recompensar GPS ruim.
- Não recompensar atividade cancelada.
- Não criar fórmula difícil de explicar.
- Não depender de ranking para validar a proposta principal.
- Não criar competição forte antes de regras mínimas anti-fraude.

## Pontos pendentes

- Balanceamento da distancia minima para XP apos testes reais.
- Tratamento de atividades suspeitas.
- Curva final de nivel.
- Métrica oficial de ranking.
- Sync remoto de eventos XP e conquistas.
- Migracao, se um dia fizer sentido, de medalhas visuais legadas para conquistas reais.

## Documentos relacionados

- [[02-mvp]]
- [[03-mecanica-territorios]]
- [[05-gps-e-validacao]]
- [[08-firebase-firestore]]
