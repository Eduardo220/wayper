> Data da auditoria: 2026-08-24

# WAYPER CURRENT ARCHITECTURE

## Resumo executivo

`MapScreen` é hoje um componente de integração crítico, com características de tela, controller e god component. Ele não é a fonte canônica da corrida, mas coordena grande parte da projeção de estado, watcher foreground, lifecycle visual, start/pause/resume, finalização, recovery, territórios, câmera, replay, diagnóstico, compartilhamento e dezenas de overlays.

Veredito resumido:

- Estado arquitetural: `CRÍTICO` para manutenção e refatoração.
- Fonte canônica da corrida: fora da tela, em `activeRunTrackingService`/`activeRunState`.
- Risco de refatoração integral: `VERY HIGH`.
- Segurança para começar: `YES, WITH PRECONDITIONS`.
- Bugs P0 encontrados: nenhum.
- Bugs/riscos P1 confirmados: seis, quatro deles fora do `MapScreen`, mas atravessando seus fluxos.
- Testes: 56 suítes e 623 testes passaram; não há teste comportamental do `MapScreen` ou de câmera/MapLibre.
- Gate físico Android: ainda aberto.
- Código alterado: nenhum.

A descoberta começou pelo Graphify estrutural: 434 arquivos, 3.757 nós e 10.974 arestas. As conclusões do grafo foram confirmadas no source, callers e testes. Os artefatos temporários do Graphify foram removidos ao final.

---

## Repository

- `CONFIRMED` Root real: `/home/eduardo/Wayper/wayper`.
- `CONFIRMED` Branch mobile: `develop`.
- `CONFIRMED` Worktree mobile: limpo antes e depois da auditoria.
- `CONFIRMED` `git diff --check`: passou.
- `CONFIRMED` Repositório separado `../wayper-site`: branch `dev`, com README modificado e muitos arquivos não rastreados. Esse WIP foi preservado e não pertence ao worktree mobile.
- `CONFIRMED` Existe também `../wayper-site-backup-20260811-190126`.
- `CONFIRMED` `develop` é a branch ativa e `main` é referência estável, conforme [AGENTS.md](/home/eduardo/Wayper/wayper/AGENTS.md:1).

Estrutura mobile observada:

```text
App.js / index.js
android/
src/
  components/
  config/
  hooks/
  navigation/
  repositories/
  screens/
  services/
  storage/
  tasks/
  theme/
  utils/
scripts/
docs/
plugins/
```

Contagem aproximada de arquivos por área: `services` 120, `components` 42, `utils` 25, `repositories` 22 incluindo testes, `screens` 21, `hooks` 4 e `tasks` 1.

---

## Mobile stack

`CONFIRMED`, pelo [package.json](/home/eduardo/Wayper/wayper/package.json:1):

| Área | Stack atual |
|---|---|
| Runtime | Expo 54.0.36, React Native 0.81.5, React 19.1 |
| Navegação | React Navigation 7, Drawer + Native Stack |
| Mapa | MapLibre React Native 11.2.1 |
| GPS/background | Expo Location 19.0.8, Task Manager 14.0.9 |
| Estado assíncrono | React Query 5.90; não usado pelo `MapScreen` |
| Persistência | AsyncStorage 2.2, limite Android configurado em 32 MB |
| Backend | Firebase Auth, Firestore e Storage |
| Geometria | Turf 7.3 |
| Diagnóstico | Sentry React Native 7.2, logs locais/file-system |
| Animação/UI | Reanimated, Moti, SVG, LinearGradient |
| Testes | Jest 29.7 |
| Qualidade | ESLint e Harness próprio |

Não há Redux, Zustand ou MobX. O runtime da corrida usa um service singleton, snapshot persistido e eventos.

---

## App bootstrap

`CONFIRMED`:

1. [index.js](/home/eduardo/Wayper/wayper/index.js:1) carrega gesture handler.
2. Importa [activeRunLocationTask.js](/home/eduardo/Wayper/wayper/src/tasks/activeRunLocationTask.js:1) antes da árvore React.
3. Registra o headless task `WayperRunNotificationAction`.
4. Inicializa Sentry.
5. Registra o `App`.

[App.js](/home/eduardo/Wayper/wayper/App.js:81) instala:

- `QueryClientProvider`;
- `ErrorBoundary`;
- auth gate via `onAuthStateChanged`;
- root `NavigationContainer`;
- error reporter global;
- performance diagnostics;
- active-run auto-checkpointing;
- notification coordinator;
- deep links;
- contexto de usuário/tela no Sentry.

`P3 RISK`: `App.js` exporta `wrapWithMonitoring(App)` e `index.js` envolve o componente importado novamente. `initializeMonitoring()` é idempotente, mas, com Sentry habilitado, há potencial de HOC duplo. Isso não foi exercitado nesta auditoria.

---

## Navigation

`CONFIRMED`:

- Root stack: `Main`, `Login`, `Register` em [App.js](/home/eduardo/Wayper/wayper/App.js:183).
- Drawer principal em [MainNavigator.js](/home/eduardo/Wayper/wayper/src/navigation/MainNavigator.js:252).
- `Mapa` monta o `MapScreen` em [MainNavigator.js](/home/eduardo/Wayper/wayper/src/navigation/MainNavigator.js:442).
- Rotas incluem Inicio, Mapa, Corridas, Dashboard, Perfil, Ranking, Amigos, Grupos e Configurações.
- O navigator consulta snapshot/recovery no startup e escolhe `Mapa` se houver corrida recuperável [MainNavigator.js](/home/eduardo/Wayper/wayper/src/navigation/MainNavigator.js:302).
- Migrações locais, auto-sync e processamento deferred são iniciados no shell, não no `MapScreen` [MainNavigator.js](/home/eduardo/Wayper/wayper/src/navigation/MainNavigator.js:288).

---

## Active run

`CONFIRMED`:

- Fonte canônica: chave `wayper:activeRun:v2`, definida em [activeRunState.js](/home/eduardo/Wayper/wayper/src/services/runTracking/activeRunState.js:7).
- Owner: [activeRunTrackingService.js](/home/eduardo/Wayper/wayper/src/services/runTracking/activeRunTrackingService.js:1).
- O service serializa ingestão e transições, mantém sessão de tracking, snapshot, backup, chunks e runtime.
- `trustedPath` é fonte de métricas.
- `rawPath` é diagnóstico.
- `liveRenderPath`/`renderPath` são apresentação.
- `segments` preservam pausas e gaps.
- O `MapScreen` recebe snapshots e mantém apenas espelhos de UI [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:2030).

Pipeline foreground:

```text
Expo Location watchPositionAsync
        ↓
MapScreen.handleLocationUpdate
        ↓
activeRunTrackingService.recordLocation
        ↓
fila serial de ingestão
        ↓
trackingPathService
  normalização → filtro → segmentos → distância
        ↓
snapshot wayper:activeRun:v2
        ↓ evento, throttled a ~1 Hz
MapScreen presentation state
```

O `MapScreen` não filtra o mesmo ponto em uma sessão paralela: delega a ingestão ao service em [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:1494).

---

## Background tracking

`CONFIRMED`:

```text
index.js
  ↓ defineTask em escopo global
activeRunLocationTask
  ↓
handleActiveRunLocationTask
  ↓
activeRunTrackingService
  ↓
mesmo pipeline canônico
  ↓
checkpoint local
```

A task não depende de `MapScreen` montado [activeRunLocationTask.js](/home/eduardo/Wayper/wayper/src/tasks/activeRunLocationTask.js:9). Desmontar a tela remove watcher/timers foreground, mas não para deliberadamente a task nem apaga o snapshot [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:1329).

`P1 BUG`: após recriação do processo Android, o owner nativo fica somente em memória e volta `null`. O primeiro lote headless captura um fence sem owner e é rejeitado antes que o snapshot carregado possa reassumir ownership [activeRunTrackingService.js](/home/eduardo/Wayper/wayper/src/services/runTracking/activeRunTrackingService.js:2830). O contrato exige `ownerClaim.mode="process_recovery"`, mas esse claim existe somente em testes; callers de produção não o enviam [activeRunTrackingService.js](/home/eduardo/Wayper/wayper/src/services/runTracking/activeRunTrackingService.js:3065).

Consequência: a independência estrutural da tela está correta, mas o recovery headless após process recreation não está completamente conectado.

---

## Persistence

Fontes persistidas confirmadas:

| Dado | Chave/owner | Papel |
|---|---|---|
| Corrida ativa | `wayper:activeRun:v2` / active-run service | Canônica |
| Checkpoint legado | `wayper_active_offline_run_v1` | Compatibilidade e rascunho recuperável |
| Corridas finalizadas | `runs` / `sync.js`, exposto por RunRepository | Histórico canônico final |
| Territórios | `wayper_territories_v1` | Território local atual |
| Eventos territoriais | `wayper_territory_events_v1` | Eventos locais |
| Leaderboards territoriais | `wayper_territory_leaderboards_v1` | Cache/ranking local |
| Deferred pós-run | `wayper_run_deferred_tasks_v1` | Trabalho derivado |
| Diagnósticos | AsyncStorage + file-system | Logs/export |
| Firebase Auth | AsyncStorage | Sessão de autenticação |

Ordem nominal de finalização:

```text
FINISHING
↓
checkpoint/freeze
↓
snapshot FINISHED
↓
save mínimo em runs
↓
schedule sync
↓
cleanup canônico + legado
↓
liberação da UI
↓
fila derivada
```

Firestore não participa do save mínimo [runFinalizationService.js](/home/eduardo/Wayper/wayper/src/services/run/runFinalizationService.js:372).

`P1 BUG`: `sync.saveLocalRun()` faz read-modify-write da lista inteira sem fila/mutex [sync.js](/home/eduardo/Wayper/wayper/src/utils/sync.js:780). Finalização e auto-sync podem ler a mesma lista antiga e a última gravação remover a corrida recém-salva. A finalização confia no objeto retornado e pode limpar os snapshots sem reler `runs`.

---

## Sync

`CONFIRMED`:

- `sync.js` contém histórico local, payload remoto e sync Firestore.
- `RunRepository` é a facade para telas de histórico/detalhes.
- `runSyncQueueService`/`RunSyncQueueRepository` agendam e processam sync de runs.
- `runDeferredTaskQueueService` coordena território, XP, ranking, feed, diagnostics e cleanup posteriores.
- `MainNavigator` inicia auto-sync e auto-processing quando o perfil está disponível.
- `MapScreen` também dispara `process()` após finalização e recovery.

Riscos confirmados:

- `P1`: writers concorrentes em `runs`.
- `P2`: enqueue/update/recovery/retry da deferred queue fazem read-modify-write sem serialização.
- `P2`: tarefas terminais nunca são podadas; ao passar de 250 itens, novas tarefas podem ser truncadas silenciosamente [runDeferredTaskQueueService.js](/home/eduardo/Wayper/wayper/src/services/run/runDeferredTaskQueueService.js:289).

AsyncStorage serializar operações individuais não torna atômico o ciclo `getItem → calcular → setItem`.

---

## Territory

`CONFIRMED`:

```text
finished run em runs
       ↓
deferred TERRITORY_CAPTURE
       ↓
territoryAntiFraudService
       ↓
territoryGeometryService / Turf
       ↓
territoryCaptureService
       ↓
territoryStorageService
       ↓
TerritoryRepository
       ↓
territoryMapService
       ↓
WayperMapLibre
```

A captura definitiva ocorre depois do save mínimo. Durante a corrida, o `MapScreen` mantém apenas preview visual.

Fontes:

- minhas zonas: cache local + remoto de viewport;
- zonas de terceiros: remoto de viewport;
- seleção: `selectedTerritory`;
- ranking territorial: services de leaderboard/ranking;
- GeoJSON: `territoryMapService`;
- persistência: `territoryStorageService`;
- sync: posterior e separado de runs.

Bugs relevantes:

- `P1`: captura de produção não fornece `existingTerritories`; offline, o serviço consulta apenas Firestore e ignora vizinhos locais [territoryCaptureService.js](/home/eduardo/Wayper/wayper/src/services/territory/territoryCaptureService.js:179).
- `P1`: falha de AsyncStorage retorna `[]`, mas a captura pode continuar como `ok:true` [territoryStorageService.js](/home/eduardo/Wayper/wayper/src/services/territory/territoryStorageService.js:300).
- `P2`: anti-fraude achata segmentos antes de medir saltos, conectando artificialmente pausa/gap.
- `P2`: cálculo de ranking pode atribuir área total a célula de bbox sem interseção real.
- `P2`: viewport posterior consulta apenas remoto; territórios locais fora do viewport inicial somem offline [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:690).

---

## Map

`CONFIRMED`:

- `MapScreen` é a única tela principal de mapa.
- Ele agrega localização, rota ativa, replay, preview de zona, territórios, células líderes, seleção e comandos de câmera.
- O mapa-base é OpenFreeMap.
- Não há estado global dedicado ao mapa.
- O estado visual do mapa é composto dentro do `MapScreen` e passado ao adapter.

---

## MapLibre

Fronteira principal: [WayperMapLibre.js](/home/eduardo/Wayper/wayper/src/components/Map/WayperMapLibre.js:691).

Métricas:

- 1.444 linhas físicas; 1.353 significativas para ESLint.
- Função principal: 619 linhas, complexidade 60.
- 8 `ShapeSource`.
- 19 `Layer`.
- 1 `Camera`.
- 2 `Marker`.
- Tipos de layer: `fill`, `line` e `circle`.
- Não há `SymbolLayer` específico.
- Estilo escuro próprio baseado em tiles/glyphs OpenFreeMap.
- Sem troca de estilo comandada pelo `MapScreen`.

Responsabilidades corretamente na fronteira MapLibre:

- `{latitude, longitude}` → `[longitude, latitude]`;
- FeatureCollection/LineString/MultiLineString/Polygon/Point;
- sources e layers;
- propriedades de press;
- bbox do viewport;
- gesto de usuário;
- comando imperativo de câmera.

Chamada imperativa encontrada:

```text
cameraRef.current.setStop({ center, zoom, duration, easing })
```

em [WayperMapLibre.js](/home/eduardo/Wayper/wayper/src/components/Map/WayperMapLibre.js:846).

Não existem `flyTo`, `fitBounds` ou `setCamera` diretamente no `MapScreen`. `fitToContent` existe no adapter, mas a tela envia `false`.

`P2 BUG`: o cache de `buildRunLineGeoJson` usa apenas modo, contagem e último ponto; omite pontos intermediários e `properties`, podendo devolver rota/propriedades antigas [trackGeojson.js](/home/eduardo/Wayper/wayper/src/services/runTracking/trackGeojson.js:36).

---

## Permissions

`CONFIRMED`:

- No mount, a tela consulta foreground location sem abrir prompt.
- No início da corrida, `ensureLocationForRun()` pode solicitar foreground.
- Background location é consultada/solicitada pela tela ao armar tracking.
- Notificações Android são educadas/solicitadas durante o preflight.
- Estados bloqueados usam `PermissionNotice`/`openAppSettings`.
- Negar notificações não bloqueia a corrida.
- Negar background permite corrida foreground, mas a UI apresenta limitação.

O service centraliza normalização e single-flight dos prompts em [permissions.js](/home/eduardo/Wayper/wayper/src/services/permissions.js:1). O `MapScreen` ainda decide quando consultar, solicitar e como reagir.

---

## Notifications

`CONFIRMED`:

- Implementação Android nativa própria, não `expo-notifications`.
- Foreground service `START_STICKY`.
- Receiver + Headless JS action service.
- Native module `WayperRunNotificationAndroid`.
- Coordenador global em `App.js`.
- Payload vem do snapshot canônico.
- Ações pause/resume executam services, não handlers do `MapScreen`.
- Abrir a notificação navega ao mapa e dispara recovery/reentry.

Arquivos centrais:

- [RunNotificationForegroundService.kt](/home/eduardo/Wayper/wayper/android/app/src/main/java/com/wayper/app/run/RunNotificationForegroundService.kt:20)
- [runNotificationService.js](/home/eduardo/Wayper/wayper/src/services/run/runNotificationService.js:1)
- [rootNavigation.js](/home/eduardo/Wayper/wayper/src/navigation/rootNavigation.js:1)

---

## Diagnostics

`CONFIRMED`:

- Sentry sanitizado para erros/breadcrumbs.
- Performance watchdog global.
- Logs locais estruturados.
- Snapshot emergencial leve dentro do `MapScreen`.
- ZIP completo permanece na DiagnosticsScreen.
- Coordenadas precisas desligadas por padrão.
- Finalização cancela/libera diagnóstico ativo antes do save.

O atalho no `MapScreen` é uma exceção deliberada pelo ADR-023, não dívida acidental. O problema é seu volume de coordenação local, não a existência do botão.

---

## Site

`CONFIRMED`, mas fora do escopo funcional desta auditoria:

- Repositório separado em `../wayper-site`.
- Next 16, React 19, TypeScript, Three/R3F, Vitest e Playwright.
- Branch `dev` com WIP significativo.
- Nenhuma dependência estrutural do `MapScreen` para esse site foi encontrada.

---

## Harness

`CONFIRMED`:

- Tarefa classificada como `INVESTIGATION + ARCHITECTURAL AUDIT + CRITICAL_RUNTIME`.
- Flags: lifecycle, concurrency, GPS/geo, offline storage, sync, performance, native Android e documentação.
- Graphify-first executado.
- Thread principal atuou como `MASTER`/one-writer.
- Especialistas lifecycle, persistence/concurrency e geospatial atuaram read-only.
- `max_depth=1`; nenhum spawn recursivo.
- Ponytail FULL aplicado: nenhuma arquitetura nova foi inventada.
- Caveman não foi usado porque o entregável exige relatório detalhado.
- “Superpowers” não estava disponível entre as skills instaladas.
- Código e testes atuais prevaleceram sobre docs divergentes.

---

## Tests

Validação executada:

| Check | Resultado |
|---|---|
| Jest completo | 56 suítes, 623 testes, todos passaram |
| ESLint completo | 0 erros, 336 warnings |
| ESLint MapScreen + MapLibre | 0 erros, 63 warnings: 58 + 5 |
| Architecture gate | PASS |
| Code size gate | PASS, via baseline |
| `git diff --check` | PASS |
| Device/emulador | `NOT_RUN` |

O code-size gate passar significa “sem regressão em relação ao baseline”, não que o tamanho atual seja saudável.

Cobertura real:

- Forte: tracking service/state, transitions, lifecycle contract, recovery, finalization, notifications, permissions, territory services, repositories, sync.
- Parcial: integração local-first por services.
- Fraca: `MapScreen`, câmera, gestos, sources/layers, mount/unmount e races assíncronas.
- Inexistente: renderização comportamental do `MapScreen` e `WayperMapLibre`.
- Físico: gate Android ainda parcial/reprovado na rodada registrada [22-teste-real-corrida-background.md](/home/eduardo/Wayper/wayper/docs/22-teste-real-corrida-background.md:21).

Um teste de ordem possui falso positivo: compara `indexOf()` sem validar `-1`; a chamada ausente de background satisfaz a comparação [activeRunState.test.js](/home/eduardo/Wayper/wayper/src/services/runTracking/__tests__/activeRunState.test.js:522).

---

## Contexto documental

### A. Confirmado pelo código atual

- Corrida ativa canônica fora da UI.
- Task headless registrada antes do React.
- Foreground e background convergem no mesmo tracking service.
- Save mínimo local precede derivados.
- Firestore fora do caminho crítico.
- Território definitivo deferred.
- MapLibre isolado no adapter.
- `MapScreen` é integração, não store.
- Repositories/facades locais existem.
- Módulos `runService.js` e `zonesStorage.js` não têm consumers de produção.

### B. Confirmado pela documentação

- Arquitetura local-first [04-arquitetura.md](/home/eduardo/Wayper/wayper/docs/04-arquitetura.md:9).
- Owners e boundaries [architecture-boundaries.md](/home/eduardo/Wayper/wayper/docs/ai/architecture-boundaries.md:15).
- GPS headless, UI a ~1 Hz e preview territorial a 5 segundos no ADR-027 [08-decisoes-tecnicas.md](/home/eduardo/Wayper/wayper/docs/08-decisoes-tecnicas.md:487).
- Save mínimo antes de território/XP/sync no ADR-026.
- Identidade/transições confirmadas no ADR-028.
- Gate físico aberto.
- `MapScreen` e active-run service classificados como hotspots críticos [code-budgets.md](/home/eduardo/Wayper/wayper/docs/ai/code-budgets.md:135).

### C. Documentação possivelmente desatualizada

- [04-arquitetura.md](/home/eduardo/Wayper/wayper/docs/04-arquitetura.md:38) diz que sync é agendado depois do cleanup; o código agenda antes.
- [03-backlog.md](/home/eduardo/Wayper/wayper/docs/03-backlog.md:82) chama a orquestração de finalização de “fora da tela”; lock/save foram extraídos, mas a tela ainda coordena runData, UI, recovery e enqueue.
- ADR-027 declara a consequência de recovery headless independente, mas o wiring de `ownerClaim` de produção está ausente.

### D. Informação antiga que não corresponde ao fluxo atual

- `src/services/runService.js` e chave `wayper_active_run_v1`: legado, sem consumer de produção.
- `src/storage/zonesStorage.js` e `@wayper_zones`: legado/migração.
- Regras competitivas finais de território continuam direção de produto; não devem ser confundidas com implementação completa.
- Documentação histórica de correções não prova validação física atual.

---

# MAPSCREEN ANATOMY

## Métricas objetivas

Arquivo principal: [src/screens/MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:1)

| Métrica | Valor |
|---|---:|
| Linhas físicas | 7.199 |
| Linhas significativas ESLint | 6.825 |
| Linhas da função principal | 5.148 |
| Complexidade da função | 198 |
| Import declarations | 42 |
| Imported bindings | 129 |
| `useState` | 55 |
| `useEffect` | 16 |
| `useFocusEffect` | 1 |
| `useMemo` | 1 |
| `useCallback` | 70 |
| `useRef` | 73 |
| Módulos internos de domínio/infra diretos | ≈22 |
| Blocos de responsabilidade identificados | 21 |
| Modais inline `Modal` | 6 |

Filhos principais:

- `WayperMapLibre`;
- `RunRecoveryModal`;
- `RunSummaryModal`;
- `RunShareModal`;
- `RunShareCard`;
- `TerritoryBottomSheet`;
- `PermissionNotice`;
- `WPButton`;
- `FlatList`;
- seis modais inline.

---

## Estado local — catálogo completo

Todos os `useState` provocam render quando alterados. Nenhum é persistido diretamente pelo React.

| Estado | Classe/origem | Escrita/leitura | Persistido/canônico | Frequência/efeito |
|---|---|---|---|---|
| `loading` | UI local | init → render guard | Não/não | Uma vez |
| `location` | Derivado | permission/watcher/snapshot → mapa/start | Em snapshot, não neste state | Até ~1 Hz |
| `permissionDenied` | UI derivada | checks → notices/guards | Não | Rara |
| `locationPermission` | Cache UI | permission service → notice/start | Não | Rara |
| `runPermissionNoticeVisible` | UI | start failures → notice | Não | Evento |
| `runLimitationNotice` | UI | background/notification permission → notice | Não | Evento |
| `recoveryNoticeVisible` | UI | restore → banner | Não | Evento/timer |
| `pendingRecovery` | Cache de domínio | recovery service → modal/actions | Fonte em storage | Evento |
| `recoveryModalVisible` | UI | recovery → modal | Não | Evento |
| `recoveryActionLoading` | UI | actions → modal | Não | Evento |
| `running` | Espelho derivado | snapshot/start/reset → render/map | Não; canônico no service | Até ~1 Hz/transição |
| `paused` | Espelho derivado | snapshot/pause/resume | Não; canônico no service | Transição |
| `replaying` | UI runtime | replay start/stop | Não | Frame lifecycle |
| `mapFollowEnabled` | UI/câmera | gestures/recenter/run | Não | GPS/gesto |
| `mapRecenterSignal` | UI/câmera | recenter/start | Não | Evento |
| `showZones` | UI suspeito | inicializado `true`, sem setter | Não | Constante disfarçada |
| `selectModeVisible` | UI | start UI | Não | Evento |
| `isStartingRun` | UI/runtime | preflight/start | Não | Curta |
| `counting` | UI/runtime | countdown | Não | Curta |
| `countdown` | UI | timer de start | Não | Tick |
| `showRunModal` | UI | finish/recovery | Não | Evento |
| `currentRunData` | Cache | finish/recovery/save → resumo | Fonte em `runs` | Evento |
| `territories` | Cache | repo/remoto/deferred → mapa | Fonte no repo/remoto | Viewport/evento |
| `leaderCells` | Derivado | leaderboard viewport → mapa | Cache territorial | Viewport |
| `selectedTerritory` | UI selection | press/params → sheet/map | Não | Evento |
| `selectedTerritoryLeaderboard` | Cache UI | leaderboard service → sheet | Fonte service/cache | Evento |
| `captureResult` | Derivado/cache | deferred capture → resumo | Resultado em run | Evento |
| `territoryLoading` | UI | viewport/panel loads | Não | Viewport |
| `mapFocusCenter` | UI/câmera | seleção/params/recenter | Não | Evento |
| `zonesPanelVisible` | UI | controls | Não | Evento |
| `zonesPanelTab` | UI | panel | Não | Evento |
| `zonesRanking` | Cache | ranking service | Fonte ranking | Evento |
| `zonesPanelLoading` | UI | ranking/local loads | Não | Evento |
| `selectedRankingUser` | UI/cache | ranking selection | Não | Evento |
| `routeState` | Espelho derivado | snapshot/final/reset | Canônico em trustedPath | Até ~1 Hz |
| `displayRouteState` | Visual derivado | snapshot | Não; máximo 2.500 | Até ~1 Hz |
| `displayRouteSegments` | Visual derivado | snapshot | Não | Até ~1 Hz |
| `replayPathState` | UI runtime | replay frame | Não | Até cada frame |
| `replaySegmentsState` | UI runtime | replay frame | Não | Até cada frame |
| `replaySpeed` | UI | controls | Não | Evento |
| `distanceState` | Espelho derivado | snapshot/replay/reset | Canônico no snapshot | 1 Hz/frame |
| `timeSec` | Espelho derivado | timer/snapshot/replay | Canônico por timeline | 1 Hz/frame |
| `runsList` | Cache | `runs`/save/deferred | Fonte em `runs` | Evento |
| `polygons` | Preview visual | preview territorial | Não canônico | A cada ≥5 s |
| `completedZonePreview` | Preview visual | deferred/summary | Derivado | Evento |
| `mode` | Espelho derivado | start/snapshot/reset | Canônico no snapshot | Transição |
| `gpsQualityWarning` | Derivado | snapshot quality | Fonte no snapshot | Até ~1 Hz |
| `runtimeRecovering` | UI/runtime | hydration | Não | Evento |
| `isFinishingRun` | UI/runtime | finish lock | Lock real no service | Evento |
| `showRunsModal` | UI | controls | Não | Evento |
| `showSavedModal` | UI | summary save | Não | Evento |
| `savedShareVisible` | UI | sharing | Não | Evento |
| `lastSavedRun` | Cache | summary save | Fonte em `runs` | Evento |
| `shareLoading` | UI | share/download | Não | Evento |
| `emergencyDiagnosticsLoading` | UI | export | Não | Evento |

### Outras fontes de estado

- Firebase Auth singleton: `auth.currentUser`.
- Snapshot/eventos de `activeRunTrackingService`.
- `route.params` e navigation state.
- `AppState`.
- repositories e services locais/remotos.
- Não há selector/store React compartilhado.
- Não há custom hook de mapa.

### Refs — 73

| Grupo | Refs | Papel |
|---|---|---|
| Share/diagnóstico | `savedFullShareRef`, `savedRouteShareRef`, `emergencyDiagnosticsInFlightRef`, `emergencyDiagnosticsTokenRef` | Elementos capturáveis e single-flight |
| Foreground/timers | `watcherRef`, `timerRef`, `backgroundPermissionWarnedRef`, `timeSecRef`, `appStateRef`, `mountedRef`, `locationPermissionRef`, `isStartingRunRef`, `runStartCountdownIntervalRef` | Recursos imperativos |
| Replay | `replayIntervalRef`, `replayFrameRef`, `replayPathRef`, `replaySegmentsRef`, `replayTimelineRef`, `replayLastFrameAtRef`, `replayElapsedRef`, `replaySpeedRef`, `replayRunRef`, `replayReturnRef`, `lastReplayRequestRef` | Máquina de replay |
| Espelho da corrida | `rawPathRef`, `savedPathRef`, `displayPathRef`, `displaySegmentsRef`, `trackingSessionRef`, `lastTrackingFinishRef`, `lastAcceptedLocationRef`, `currentRunIdRef`, `routeStateRef`, `distanceRef`, `runningRef`, `runStatusRef`, `modeRef` | Projeção imperativa do snapshot |
| Throttle UI | `pendingActiveRunUiSnapshotRef`, `activeRunUiTimerRef`, `lastActiveRunUiAtRef` | Janela de ~1 Hz |
| Locks/recovery | `finishInFlightRef`, `isFinishingRunRef`, `watcherStartTokenRef`, `activeRunRestoreAttemptedRef`, `restoreActiveRunForReentryRef`, `restoringActiveRunRef`, `runtimeHydrationInFlightRef`, `lastNotificationOpenRequestRef` | Identidade, exclusão e reentrada |
| Território/câmera | `zonePreviewLastAtRef`, `zonePreviewLastPointCountRef`, `liveTrackingRef`, `territoryViewportDebounceRef`, `lastTerritoryFetchRef`, `initialTerritoryLoadRef`, `selectedTerritoryRequestRef`, `lastRouteFocusRef` | Preview, fetch e seleção |
| Diagnóstico/stall | 14 refs `last*`, contadores e motivos descartados | Heartbeat, watcher, map stall, erros |
| Animação | `routeFadeAnim`, `startPulseAnim`, `startPressAnim` | Animated values |

### Duas fontes de verdade?

Há duplicação estrutural, mas a intenção atual é “canônico + projeção”:

```text
snapshot canônico
  ↕
running/paused/mode/path/distance/time React state
  ↕
runningRef/runStatusRef/path refs/distanceRef/timeSecRef
```

As proteções contra snapshot vazio, geometria menor, distância regressiva e tempo regressivo mostram que a duplicação já causou risco suficiente para exigir guards [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:2063).

Classificação: `DUPLICADO/SUSPEITO`, não porque o React state seja canônico, mas porque três representações precisam permanecer sincronizadas.

---

## Effects

| # | Linhas | Objetivo/dependencies | Side effect e cleanup | Risco |
|---:|---|---|---|---|
| 1 | 597 | Mount log, `[]` | Log de mount/unmount | Baixo |
| 2 | 616 | Espelhar `mode` | Atualiza `modeRef` | Baixo |
| 3 | 620 | Follow após transição | Set camera intent | Médio |
| 4 | 635 | Pulse do botão | Animated loop; `stop()` | Baixo |
| 5 | 744 | Carga territorial inicial | Repo/remoto; mount guards | Médio |
| 6 | 753 | Cleanup debounce | `clearTimeout` | Baixo |
| 7 | 816 | Params de território/cell/user | Seleção, fetch, câmera | Médio |
| 8 | 1174 | Init geral | Permission, location, AppState, restore, history; cleanup watcher/timers | `P2` |
| 9 | 1995 | Rearmar watcher/timer no active | Segundo AppState listener; cleanup correto | Médio/alto |
| 10 | 2282 | Subscription canônica | Throttle de pontos; unsubscribe/timeout cleanup | Crítico |
| 11 | 3854 | Expor callback de restore em ref | Limpa ref | Crítico |
| 12 | 3863 | Focus/blur | Hydration no focus; sem cancelamento da Promise | `P2` |
| 13 | 3900 | Notification/deep-link | Restore e limpa params | `P2` |
| 14 | 3944 | Cold-start recovery | Busca/hidrata/modal; possui flag `cancelled` | Crítico |
| 15 | 4391 | Replay por route params | Inicia replay | Médio |
| 16 | 4614 | Diagnóstico de rota/mapa | Atualiza runtime/logs | Médio/performance |
| 17 | 4660 | Heartbeat/stall | Intervalo de 30 s; cleanup | Médio |

Problemas de effects:

- Init pode registrar AppState listener depois do unmount.
- Recovery/reentry pode resolver depois do cleanup e rearmar watcher/timer numa instância desmontada.
- Existem dois listeners AppState com propósitos diferentes, aumentando risco de ordering.
- ESLint aponta dependências ausentes no init e no `startWithCountdown`.

---

## Responsabilidades

| Responsabilidade | Onde está | Por que está na tela | Dependências/source of truth | Classificação/risco |
|---|---|---|---|---|
| UI/presentation | 4740–5930 | Render da jornada | React state | `ACOPLADO` |
| Map rendering | 4859 | Composição de props | Estados visuais | `ACEITÁVEL` |
| MapLibre adapter | WayperMapLibre | Filho especializado | MapLibre | `ACEITÁVEL` |
| Camera | 620–690, params, props | Intenção de UX | UI state; adapter executa | `ACEITÁVEL` |
| User location | 924–952 | Ponto inicial/idle | Expo Location/snapshot | `ACOPLADO` |
| Active run commands | 2396–3122 | Botões e feedback | active-run service | `ACOPLADO` |
| GPS foreground | 1494–1940 | Complemento com tela ativa | Expo Location → service | `MAL POSICIONADO` |
| GPS background | 1603–1721 | Solicita lifecycle | Service/task são owners | `ACOPLADO` |
| Run route | 2030–2331 | Projeção visual | canonical snapshot | `ACOPLADO` |
| Finish | 3158–3740 | Handoff da UI | finalization service + sync | `CRÍTICO` |
| Recovery | 3743–4169 | Modal/reentry | recovery/runtime services | `CRÍTICO` |
| Territory viewport | 690–776 | Mapa precisa dos dados | repo + remoto | `MAL POSICIONADO` |
| Territory preview | 1426–1483 | Feedback visual | trustedPath derivado | `CANDIDATO À EXTRAÇÃO` |
| Territory selection | 778–923 | Interação | services + route params | `ACOPLADO` |
| Territory ranking | 866–923 | Painel/map focus | ranking/territory service | `MAL POSICIONADO` |
| Persistence/sync | finish/recovery/summary | Salvar e atualizar UI | `sync.js`, repos, queues | `MAL POSICIONADO` |
| Replay | 4170–4390 | Playback no mapa | runReplay + RAF | `MAL POSICIONADO` |
| Sharing | 4423–4613, render | Pós-corrida | share utils/refs | `MAL POSICIONADO` |
| Permissions | init/start/background | UX dos prompts | permissions service | `ACOPLADO` |
| Lifecycle | init/AppState/focus | Reentrada e foreground | AppState/runtime | `CRÍTICO` |
| Diagnostics | 955–1173, heartbeat | Evidência durante freeze | diagnostics services | `ACEITÁVEL`, porém volumoso |

---

# DEPENDENCY GRAPH

```text
DOMAIN
 activeRunTrackingService ───────────────┐
 activeRunRuntimeService ────────────────┤
 runAutoSaveService ─────────────────────┤
 runRecoveryService ─────────────────────┤
 runFinalizationService ─────────────────┤
 tracking/path/render services ──────────┤
 territory services ─────────────────────┤
 ranking service ────────────────────────┤
 permissions service ────────────────────┤
                                         │
INFRASTRUCTURE                            ▼
 Expo Location ─────────────────────── MapScreen
 Firebase Auth ──────────────────────────┤
 sync.js / runs ─────────────────────────┤
 territoryRepository ────────────────────┤
 deferredQueueRepository ────────────────┤
 diagnostics/Sentry ─────────────────────┤
 navigation/AppState ────────────────────┘
                                         │
                ┌────────────────────────┼─────────────────────────┐
                ▼                        ▼                         ▼
PRESENTATION  run/recovery/share     overlays/controls        territory sheet
              modals/cards           inline modals            permission notices
                                         │
                                         ▼
MAP ADAPTER                     WayperMapLibre
                          ┌──────────────┼──────────────┐
                          ▼              ▼              ▼
                    run GeoJSON    territory GeoJSON   camera/events
                          │              │              │
                          └──────────────┴──────────────┘
                                         ▼
                                  MapLibre Map
                              ShapeSource / Layer
```

Source-of-truth flow:

```text
wayper:activeRun:v2
        ↓
activeRunTrackingService
        ↓ snapshot event
MapScreen projection states/refs
        ↓
WayperMapLibre
        ↓
trackGeojson + territoryMapService
        ↓
MapLibre sources/layers
```

---

# DATA FLOW

## Active Run

```text
FOREGROUND GPS                     BACKGROUND GPS
watchPositionAsync                 TaskManager task
       │                                  │
       └──────────────┬───────────────────┘
                      ▼
       activeRunTrackingService.recordLocation
                      ▼
      normalize → filter → segments → distance
                      ▼
       active session + wayper:activeRun:v2
                      ▼
        snapshot event / checkpoint batch
                      ▼
     MapScreen UI projection, máximo ~1 Hz
                      ▼
           WayperMapLibre route source
```

Quem faz o quê:

- inicia: `MapScreen` chama `startActiveRun`; service arma lifecycle;
- pausa/retoma: tela solicita, service confirma identidade/status;
- recebe/filtra/calcula distância: tracking service;
- persiste: active-run service/autosave;
- atualiza UI: `MapScreen`;
- desenha: WayperMapLibre;
- start/end markers: adapter, quando habilitados;
- desmontagem: para foreground local, não a corrida;
- `FINISHING`: service/finalization; tela coordena handoff;
- offline: tracking e save continuam locais.

## Territory

```text
trusted finished run
        ↓
deferred TERRITORY_CAPTURE
        ↓
anti-fraud
        ↓
capture geometry / Turf
        ↓
territory/event/leaderboard models
        ↓
wayper_territories_v1 + event/leaderboard storages
        ↓
TerritoryRepository / remote best effort
        ↓
MapScreen viewport cache + selection
        ↓
territoryMapService
        ↓
MapLibre ShapeSource/layers
```

Preview durante corrida:

```text
trustedPath snapshot
  ↓ a cada ≥5 s e ≥5 pontos
MapScreen.finalizeRoutePath
  ↓
routeToZoneGeometry
  ↓
polygons state
  ↓
WayperMapLibre zones source
```

Preview não é território canônico.

## User Location

```text
permission service
      ↓
Expo getCurrentPosition/watchPosition
      ↓
active: canonical snapshot.currentLocation
idle: MapScreen location
      ↓
WayperMapLibre user-location source
```

## Camera

```text
location / replay head / route params / territory selection
                       ↓
 mapFollowEnabled + mapFocusCenter + recenterSignal
                       ↓
             WayperMapLibre camera effects
                       ↓
               Camera.setStop(...)
```

Modos observados:

- follow run;
- follow replay;
- free camera após gesto;
- recenter;
- territory/cell/ranking/user focus;
- initial location;
- idle auto-center.

Não há route fit ativo nem restore de câmera persistida. Follow, auto-center e bounds são guardados para não emitir simultaneamente; o principal risco é múltiplas fontes upstream mudarem `mapFocusCenter`.

## Map Interaction

```text
MapLibre onRegionDidChange
        ↓ bbox
MapScreen debounce 950 ms
        ↓
remote territories + leader cells
        ↓
state
        ↓
sources/layers

ShapeSource onPress
        ↓ feature properties
MapScreen selection / leaderboard fetch
        ↓
TerritoryBottomSheet ou navigation
```

## Screen Lifecycle

```text
index/process start
  ↓ headless task registration
App mount
  ↓ global autosave + notification + diagnostics
MainNavigator
  ↓ route based on active/recovery state
MapScreen mount/focus
  ↓ permission, foreground location, restore, subscriptions
background/inactive
  ↓ checkpoint + background task continues
foreground
  ↓ restore/reconcile + watcher/timer rearm
blur/unmount
  ↓ stop local watcher/timers/replay
  └── canonical run/background task intentionally survive
```

Falhas atuais:

- process recreation não reassume owner nativo automaticamente;
- init async pode vazar AppState listener;
- recovery async pode rearmar recursos após unmount.

---

# CLASSIFICAÇÃO ARQUITETURAL

| Área | Classificação | Evidência |
|---|---|---|
| Fonte canônica active-run | `OK` | Fora da tela, snapshot/service |
| Filtro/distância/segmentos | `OK` | Tracking services |
| Task headless estrutural | `ACEITÁVEL` | Bootstrap global, mas owner recovery quebrado |
| Projeção active-run na tela | `ACOPLADO` | State + refs + snapshot |
| Lifecycle foreground | `CRÍTICO` | Watcher, dois AppState listeners, races |
| Background recovery | `CRÍTICO` | Falta owner claim production |
| Finalização | `CRÍTICO` | Save extraído, coordenação ainda na tela |
| Persistência `runs` | `CRÍTICO` | Lost-update possível |
| Recovery discard | `CRÍTICO` | Falso sucesso/ressurreição |
| Territory geometry owner | `ACEITÁVEL` | Services dedicados |
| Territory composition na tela | `MAL POSICIONADO` | Cache/remoto/ranking/preview |
| MapLibre adapter | `ACEITÁVEL` | Fronteira real, porém grande |
| Camera | `ACEITÁVEL` | Um executor imperativo |
| Replay | `MAL POSICIONADO` | RAF e estado de alta frequência na tela |
| Sharing/post-run | `MAL POSICIONADO` | Grande bloco não essencial ao mapa ativo |
| Diagnóstico emergencial | `ACEITÁVEL` | Exceção deliberada |
| Presentation/overlays | `ACOPLADO` | Volume e seis modais inline |
| Testabilidade | `CRÍTICO` | Sem teste comportamental da tela |

---

# PROBLEMAS ENCONTRADOS

| ID | Sev. | Arquivo/linha | Responsabilidade | Descrição/impacto | Risco de refatoração |
|---|---|---|---|---|---|
| MS-001 | P1 | [activeRunTrackingService.js](/home/eduardo/Wayper/wayper/src/services/runTracking/activeRunTrackingService.js:2830) | Background lifecycle | Process recreation perde owner; callbacks headless são rejeitados | Muito alto |
| MS-002 | P1 | [sync.js](/home/eduardo/Wayper/wayper/src/utils/sync.js:780) | Persistência | RMW concorrente pode remover corrida já confirmada antes do cleanup | Muito alto |
| MS-003 | P1 | [runRecoveryService.js](/home/eduardo/Wayper/wayper/src/services/run/runRecoveryService.js:802) | Recovery | Discard canônico não limpa legado; falhas booleanas viram sucesso | Muito alto |
| MS-004 | P1 | [territoryCaptureService.js](/home/eduardo/Wayper/wayper/src/services/territory/territoryCaptureService.js:179) | Território offline | Captura ignora territórios locais anteriores | Alto |
| MS-005 | P1 | [territoryStorageService.js](/home/eduardo/Wayper/wayper/src/services/territory/territoryStorageService.js:300) | Persistência territorial | Escrita falha retorna vazio, captura ainda pode concluir | Alto |
| MS-006 | P1 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:452) | Arquitetura | 7.199 LOC, complexidade 198, 21 responsabilidades | Muito alto |
| MS-007 | P2 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:1174) | Lifecycle | Listener AppState pode ser criado depois do unmount | Alto |
| MS-008 | P2 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:3743) | Recovery/lifecycle | Hydration pode rearmar watcher após cleanup | Alto |
| MS-009 | P2 | [runDeferredTaskQueueService.js](/home/eduardo/Wayper/wayper/src/services/run/runDeferredTaskQueueService.js:342) | Deferred queue | Enqueue/update/process podem perder/regredir updates | Alto |
| MS-010 | P2 | [runDeferredTaskQueueService.js](/home/eduardo/Wayper/wayper/src/services/run/runDeferredTaskQueueService.js:296) | Deferred queue | Terminais não podados; cap 250 trunca silenciosamente | Médio |
| MS-011 | P2 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:2030) | State | Snapshot, React state e refs duplicam corrida visual | Muito alto |
| MS-012 | P2 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:1426) | Performance | Preview e snapshot reprocessam rota completa | Alto |
| MS-013 | P2 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:4226) | Replay/performance | Busca linear, slice/segmentação e vários sets por frame | Médio |
| MS-014 | P2 | [territoryCaptureService.js](/home/eduardo/Wayper/wayper/src/services/territory/territoryCaptureService.js:221) | Anti-fraude | Segmentos achatados criam salto artificial | Alto |
| MS-015 | P2 | [territoryLeaderboardService.js](/home/eduardo/Wayper/wayper/src/services/territory/territoryLeaderboardService.js:37) | Ranking | Célula sem interseção pode receber área total | Médio |
| MS-016 | P2 | [trackGeojson.js](/home/eduardo/Wayper/wayper/src/services/runTracking/trackGeojson.js:36) | Map adapter/cache | Cache omite geometria intermediária/properties | Alto |
| MS-017 | P2 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:423) | Territory cache | Remoto sobrescreve local sem comparar freshness | Médio |
| MS-018 | P2 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:690) | Offline map | Cache local só é consultado no viewport inicial | Médio |
| MS-019 | P2 | [activeRunState.test.js](/home/eduardo/Wayper/wayper/src/services/runTracking/__tests__/activeRunState.test.js:522) | Testes | Assertions textuais e falso positivo por `indexOf(-1)` | Muito alto |
| MS-020 | P2 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:3453) | Boundary | Tela enfileira/processa enquanto shell também possui auto-owner | Alto |
| MS-021 | P3 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:2396) | Closures | `startWithCountdown` omite `startRun` nas deps | Médio |
| MS-022 | P3 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:1187) | Legado | Quatro guards `if(false...)`, carousel `false`, state constante | Baixo |
| MS-023 | P3 | [MapScreen.js](/home/eduardo/Wayper/wayper/src/screens/MapScreen.js:5153) | Render | `keyExtractor` muta `item._tempId` | Baixo |
| MS-024 | P3 | [WayperMapLibre.js](/home/eduardo/Wayper/wayper/src/components/Map/WayperMapLibre.js:389) | Código morto | Helper MultiLineString não usado | Baixo |
| DOC-001 | P3 | [04-arquitetura.md](/home/eduardo/Wayper/wayper/docs/04-arquitetura.md:38) | Documentação | Ordem sync/cleanup não corresponde ao código | Médio |

Nenhum P0 foi identificado.

---

# COMPONENTES E EXTRAÇÕES EXISTENTES

| Nome | Responsabilidade | Nível | Qualidade da fronteira |
|---|---|---|---|
| `WayperMapLibre` | MapLibre, GeoJSON, camera, layers/events | Adapter/presentation | Real, porém grande |
| `activeRunTrackingService` | Owner canônico, ingestão, lifecycle, checkpoint | Domain/runtime | Correto, crítico |
| `activeRunState` | Schema, merge, duração | Domain | Correto, complexo |
| `activeRunRuntimeService` | Hydration/reentry/notification surface | Application/runtime | Real |
| `trackingPathService` | Filtro, segmentos, distância | Domain | Correto |
| `runFinalizationService` | Freeze, save mínimo, cleanup | Application | Extração real, mas coordenação incompleta |
| `runRecoveryService` | Seleção/hydration/cleanup | Application | Real, com bug de discard |
| `runDeferredTaskQueueService` | Pós-run durável | Application/infra | Real, com concorrência/cap |
| `territoryGeometryService` | Geometria/Turf | Domain | Boa fronteira |
| `territoryCaptureService` | Regras/captura/persistência | Domain/application | Real, com bugs |
| `territoryMapService` | Modelo territorial → GeoJSON | Map adapter | Boa fronteira |
| `TerritoryRepository` | Facade local-first | Repository | Real |
| `RunRecoveryModal` | UI de recovery | Presentation | Boa |
| `RunSummaryModal` | UI de resumo | Presentation | UI extraída; save continua inline |
| `RunShareModal/Card` | UI/export pós-run | Presentation | Boa, mas ainda pesada |
| `TerritoryBottomSheet` | UI de seleção | Presentation | Boa |
| `PermissionNotice` | UI de permissão | Presentation | Boa |

Não existe `useMapSomething` escondendo múltiplos domínios. A principal “extração incompleta” é finalization/summary: services guardam invariantes, mas o `MapScreen` ainda monta dados, coordena recovery, UI, enqueue, processamento e refresh.

---

# CANDIDATOS À SEPARAÇÃO

Sem definir destino arquitetural.

| Bloco atual | Responsabilidade | Motivo | Dependências | Risco |
|---|---|---|---|---|
| 2030–2331 | Projeção snapshot → UI | Sincronização crítica e duplicada | active-run state, watcher, preview | Muito alto |
| 1494–2028 | Foreground watcher/timer | Lifecycle de recurso | Expo Location, AppState, service | Muito alto |
| 2396–3122 | Start/pause/resume | Comandos e feedback | permissions, tracking service | Alto |
| 3158–3740 | Finish handoff | 569 linhas/complexidade 172 | finalization, sync, recovery | Muito alto |
| 3743–4169 | Recovery/reentry | Lifecycle async | runtime/recovery/navigation | Muito alto |
| 690–923 | Territory viewport/ranking | Dados e interação territorial | repo, remoto, ranking | Alto |
| 1426–1483 | Territory preview | Geometria visual periódica | tracking/territory services | Alto |
| 620–690 + params | Camera intent | Modos implícitos | map/replay/selection | Médio |
| 4170–4390 | Replay | RAF e estado de alta frequência | runReplay/map | Médio |
| 4423–4613 | Sharing | Pós-run não crítico | share utils/refs | Baixo |
| 5525–5690 | Summary save | Persistência pós-run inline | finalization/repo/queue | Alto |
| 955–1173 | Diagnóstico ativo | Export/snapshot/locks | diagnostics/share | Médio |
| 4740–5930 | Overlays/modals | Presentation massiva | todos os estados | Médio |
| WayperMapLibre 691–1345 | Camera/sources/layers | Adapter de 619 linhas | MapLibre/GeoJSON | Médio |

---

# ORDEM DE RISCO

1. Ownership nativo, task headless e process recreation.
2. Snapshot canônico, identidade e transições start/pause/resume/FINISHING.
3. Save mínimo em `runs`, confirmação e cleanup de recovery.
4. Recovery/reentry e descarte.
5. Foreground watcher, AppState e unmount.
6. Deferred queue e trabalho pós-run.
7. Segmentos, trusted path, distância e GeoJSON.
8. Captura/persistência territorial.
9. Projeção visual da corrida e performance de rota longa.
10. Câmera e interação MapLibre.
11. Replay.
12. Sharing, modais e presentation.

UI é a parte visualmente maior, mas é a parte de menor risco de perda de corrida.

---

# MAPSCREEN VERDICT

### 1. Qual é o estado arquitetural atual?

`CRÍTICO` como hotspot de integração. Os owners fundamentais existem fora da tela, mas a composição ainda é excessiva.

### 2. Ele é tela, controller, god component ou mistura?

Mistura de:

- tela;
- controller de jornada;
- coordinator de runtime foreground;
- coordinator de finalização/recovery;
- view-model manual;
- god component de mapa/pós-run.

Predominantemente: `GOD COMPONENT DE INTEGRAÇÃO`, não store canônico.

### 3. Maiores responsabilidades

- projeção active-run;
- watcher foreground e timer;
- start/pause/resume/finish;
- recovery/reentry;
- território/viewport/preview/ranking;
- câmera;
- replay;
- persistência/sync handoff;
- overlays/modais;
- share e diagnostics.

### 4. Responsabilidades claramente no lugar errado

- processamento direto de repository/queue;
- coordenação extensa de finish/recovery;
- lifecycle foreground;
- cache/remoto territorial;
- ranking territorial;
- replay frame loop;
- persistência do summary;
- grande parte do sharing pós-run.

### 5. Partes corretamente separadas

- estado canônico;
- ingestão/filtro/distância/segmentos;
- task headless;
- finalization lock e save mínimo;
- recovery service;
- geometry/capture territorial;
- repositories;
- MapLibre primitives/sources/layers;
- permissions service;
- notification service;
- diagnostics services.

### 6. Fontes canônicas

- corrida ativa: `wayper:activeRun:v2`;
- corrida finalizada: `runs`;
- território: `wayper_territories_v1`;
- eventos/leaderboards: storages territoriais próprios;
- auth: Firebase Auth;
- queue derivada: `wayper_run_deferred_tasks_v1`;
- câmera/overlays/replay: UI local, sem fonte durável.

### 7. Existe duplicação de estado?

Sim. Snapshot, React state e refs replicam status, rota, distância, duração e modo. É projeção intencional, mas frágil.

### 8. O MapScreen interfere no lifecycle da corrida?

Sim, no lifecycle foreground e na coordenação de start/pause/resume/finish/recovery. Ele não é necessário para a existência canônica da corrida nem deveria encerrar background ao desmontar.

### 9. Existe risco para background tracking?

Sim, `HIGH`, principalmente pelo bug de process-owner recovery. A estrutura independente da tela está correta; o wiring pós-recriação não.

### 10. Existe risco para persistência/recovery?

Sim, `HIGH`: lost update em `runs`, discard falso, queue races e cleanup dependente de confirmação que pode ser invalidada.

### 11. Existe risco de rerender/performance?

Sim, `HIGH` em:

- snapshot completo a ~1 Hz;
- cópias/normalizações do path;
- preview territorial;
- replay por frame;
- milhares de pontos;
- listas territoriais;
- render do componente inteiro.

Impacto físico atual: `UNKNOWN`, sem profiling em Android médio.

### 12. Existe acoplamento excessivo com MapLibre?

Moderado. A tela não chama APIs imperativas nem monta layers diretamente, o que é bom. Entretanto, controla muitos intents/props simultaneamente e depende da forma do adapter.

### 13. Risco de refatoração completa

`VERY HIGH`.

Uma reescrita big-bang não é segura.

### 14. É seguro iniciar uma refatoração estrutural agora?

`YES, WITH PRECONDITIONS`.

Precondições:

1. Corrigir ou caracterizar separadamente os P1 de owner headless, `runs`, discard e persistência/candidatos territoriais.
2. Criar testes comportamentais de mount/unmount, AppState, focus/reentry e snapshot projection.
3. Remover o falso positivo de `indexOf(-1)` e testar a ordem real via service calls.
4. Criar testes de câmera/follow/free/recenter/territory focus.
5. Testar concorrência de `runs` e deferred queue.
6. Estabelecer baseline físico Android: tela apagada, process kill, notification open/actions, offline, recovery, finish e histórico após restart.
7. Fazer extrações incrementais e reversíveis; nenhuma troca simultânea de owner e comportamento.
8. Manter uma única fonte canônica e nenhum store/service paralelo.
9. Perfilar rota longa, preview territorial e replay antes/depois.
10. Preservar o mesmo contrato de props/eventos do MapLibre em cada slice até haver caracterização equivalente.

### 15. Invariantes que devem sobreviver

- Corrida ativa independe de tela montada.
- Task headless é registrada antes do React.
- Foreground e background entram no mesmo pipeline.
- Duplicatas não inflam distância.
- `trustedPath` continua fonte de métricas.
- `renderPath` nunca altera distância, XP, território ou sync.
- Pausas/gaps continuam segmentados e não são ligados visualmente.
- Identidade `activeRunId/localRunId` permanece estável.
- Pause/resume só confirmam mesmo ID e status esperado.
- `FINISHING` continua recuperável.
- Save mínimo local precede cleanup, território, XP, ranking, share e sync remoto.
- Snapshot não é apagado sem corrida confirmada no histórico.
- Finalização continua idempotente/single-flight.
- Firestore nunca bloqueia start, tracking, finish, save ou recovery.
- Corrida offline permanece utilizável e sincronizável.
- Território nunca bloqueia ou invalida o save da corrida.
- Captura territorial definitiva continua posterior ao save.
- Território local continua utilizável offline.
- Coordenadas de domínio permanecem `{latitude, longitude}`; `[lng, lat]` só na fronteira GeoJSON.
- Desmontagem para apenas watcher/timers da tela, não a corrida.
- Recovery não pode ressuscitar corrida descartada.
- Notification actions preservam identidade/status.
- Diagnóstico ativo continua leve, sanitizado e não bloqueante.
- A futura refatoração não cria segundo runtime, queue, repository, store ou source of truth.

---

# REFACTORING INPUT PACKAGE

```text
CURRENT MAPSCREEN:
src/screens/MapScreen.js, 7.199 LOC, função 5.148 linhas,
complexidade 198, 42 imports, 55 states, 17 effects,
70 callbacks, 73 refs. God component de integração.

CANONICAL SOURCES:
active run = wayper:activeRun:v2 / activeRunTrackingService
finished runs = runs / sync.js + RunRepository
territory = wayper_territories_v1 / TerritoryRepository
deferred = wayper_run_deferred_tasks_v1
auth = Firebase Auth
MapScreen state = projection/cache/UI, nunca canônico

RESPONSIBILITIES:
UI/map, active-run projection, foreground watcher/timer,
start/pause/resume/finish, recovery/reentry, territory viewport/
preview/selection/ranking, camera, replay, sharing, permissions,
diagnostics, persistence/sync handoff, overlays/modals.

WRONG BOUNDARIES:
foreground lifecycle inside screen
finish/recovery orchestration inside screen
direct sync/repository/queue processing
territory cache/remoto/ranking/preview composition
replay RAF and summary persistence
large post-run/share surface inside active map screen

CORRECT BOUNDARIES:
canonical tracking/state outside UI
single foreground/background ingestion pipeline
global headless task
finalization lock/minimum save service
recovery services
territory geometry/capture/storage services
MapLibre sources/layers/camera adapter
permissions/notifications/diagnostics services

CRITICAL INVARIANTS:
screen-independent run
stable identity
confirmed transitions
trustedPath metrics
segments preserve gaps
FINISHING recoverable
save minimum before cleanup/derived/remote
Firestore non-blocking
offline run durable
territory cannot block run
idempotent finish/replay
background survives screen lifecycle

PERFORMANCE HOTSPOTS:
full snapshot/path projection ~1 Hz
territory preview reprocesses full route
replay does linear lookup/slice/state sets per frame
whole MapScreen rerenders
territory lists and GeoJSON regeneration
trackGeojson cache currently under-keyed

LIFECYCLE RISKS:
missing production process_recovery owner claim
AppState listener can leak after unmount
recovery Promise can rearm watcher after unmount
two AppState subscriptions
foreground controls coupled to screen

TEST COVERAGE:
56 suites / 623 tests pass
strong service/domain coverage
no behavioral MapScreen or WayperMapLibre test
source-string characterization has false positive
physical Android gate open

REFACTOR RISK:
VERY HIGH
big-bang rewrite prohibited

PRECONDITIONS:
resolve/characterize P1 bugs
add lifecycle/camera/snapshot characterization
add concurrency tests
establish physical Android baseline
profile long route/replay/territory
extract incrementally with one writer and rollback per slice
do not create parallel owners/sources
```

---

## Entrega

```text
CODE CHANGES: NONE
PRODUCTION FILES MODIFIED: NONE
REFACTORING PERFORMED: NO
```

Nenhum arquivo do repositório mobile ou dos repositórios vizinhos foi alterado.
