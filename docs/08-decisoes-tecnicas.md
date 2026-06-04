# Decisões Técnicas

Este arquivo registra decisões relevantes do projeto. Decisão não registrada vira arqueologia depois, e ninguém merece escavar commit velho.

## ADR-001: Usar React Native com Expo

**Status:** aceito  
**Contexto:** o Wayper é um app mobile com necessidade de GPS, mapa, câmera/arquivos em algumas features e build Android.  
**Decisão:** usar React Native com Expo e Expo Dev Client.  
**Consequências:**

- Desenvolvimento mobile mais rápido.
- Boa integração com módulos de localização.
- Build Android controlado por scripts.
- Algumas bibliotecas nativas exigem cuidado com prebuild/dev client.

## ADR-002: Usar Firebase como backend inicial

**Status:** aceito  
**Contexto:** o app precisa de autenticação, persistência e sincronização.  
**Decisão:** usar Firebase Auth e Firestore.  
**Consequências:**

- Menos backend próprio no início.
- Regras de segurança do Firestore viram parte crítica do projeto.
- Algumas regras de negócio sensíveis talvez precisem migrar para Cloud Functions no futuro.

## ADR-003: Usar MapLibre/OpenFreeMap para mapas

**Status:** aceito  
**Contexto:** o app depende muito de mapa e visualização de zonas.  
**Decisão:** usar MapLibre React Native com OpenFreeMap.  
**Consequências:**

- Mais controle sobre visualização do mapa.
- Menor dependência de provedores pagos tradicionais.
- Exige atenção a performance e renderização de polígonos/rotas.

## ADR-004: Usar Turf para cálculos geográficos

**Status:** aceito  
**Contexto:** o app precisa calcular distância, área e manipular geometrias.  
**Decisão:** usar Turf quando fizer sentido para cálculos geoespaciais.  
**Consequências:**

- Facilita cálculo de área e operações com GeoJSON.
- Precisa validar performance em rotas grandes.
- Cálculos críticos devem ter testes.

## ADR-005: Separar `develop` e `main`

**Status:** aceito  
**Contexto:** o projeto precisa diferenciar desenvolvimento ativo e versão oficial.  
**Decisão:** `develop` será branch de desenvolvimento, `main` será branch oficial.  
**Consequências:**

- Mudanças passam primeiro por `develop`.
- `main` deve receber apenas versões estáveis.
- Pull requests para `main` devem ser mais criteriosos.

## ADR-006: Persistir corrida ativa localmente antes do Firestore

**Status:** aceito
**Contexto:** a Wayper precisa garantir que uma corrida nao seja perdida por perda de internet, fechamento do app ou falha durante a atividade. O projeto ja usa AsyncStorage em servicos de perfil, sync, zonas e territorio, e a rota salva ja possui limites de pontos para historico e renderizacao.
**Decisao:** a corrida ativa deve ter uma camada local propria (`runOfflineStorageService`) como fonte de verdade durante a atividade. Corridas ativas devem ser persistidas localmente por checkpoint continuo e sincronizadas de forma idempotente com Firestore. A sincronizacao com Firestore acontece somente apos a corrida ser finalizada e salva localmente, com status de sync pendente ate o envio remoto concluir.
**Consequencias:**

- GPS, pausa, retomada, tempo, distancia e desenho da rota deixam de depender de Firestore durante a corrida.
- Corridas finalizadas offline aparecem no historico local como pendentes de sincronizacao.
- O app pode restaurar uma corrida ativa ou finalizada nao salva ao reabrir.
- AsyncStorage continua aceitavel nesta etapa por ser padrao atual do projeto e por usar limites de pontos; se atividades longas excederem esse volume, migrar a camada para SQLite/Expo SQLite.
- O Firestore recebe dados depois, por fila e sincronizacao automatica quando a conexao voltar.

## ADR-007: Consolidar fonte de verdade da corrida ativa

**Status:** aceito
**Contexto:** a corrida ativa passou a ter dois snapshots locais: `wayper:activeRun:v2` e `wayper_active_offline_run_v1`. A duplicidade podia recuperar estado antigo, duplicar fila de sync ou fazer uma corrida finalizada voltar como ativa.
**Decisao:** `activeRunTrackingService` / `activeRunState` sao a fonte de verdade canonica da corrida ativa. `runOfflineStorageService` permanece como checkpoint legado, compatibilidade e rascunho final temporario. `runRecoveryService` centraliza conflito, migracao e limpeza.
**Consequencias:**

- `MapScreen` nao decide mais entre storages concorrentes.
- Legado vivo e migrado para o snapshot canonico antes de chegar na UI.
- Corridas finalizadas ou pendentes de sync nao voltam como ativas.
- Checkpoints legados mais antigos nao sobrescrevem checkpoints mais recentes do mesmo `localRunId`.
- Firestore continua sendo apenas destino de sincronizacao posterior.

## ADR-008: Blindar auto-save, recovery e finalizacao offline

**Status:** aceito
**Contexto:** mesmo com a fonte canonica consolidada, ainda era necessario proteger bordas operacionais: app indo para background/inactive, tela bloqueada, erro temporario de GPS, reload durante corrida e queda durante finalizacao.
**Decisao:** manter `activeRunTrackingService`/`activeRunState` como fonte primaria e reforcar `runAutoSaveService` como checkpoint consolidado. O autosave passa a escrever periodicamente, em AppState critico, em erro recuperavel de localizacao e antes do finish. `FINISHING` e considerado estado finalizado para recovery.
**Consequencias:**

- Corrida running ou paused tem snapshots mais recentes mesmo sem novo ponto aceito.
- Falhas de GPS disparam checkpoint com throttle, sem criar trajeto falso.
- Checkpoints antigos continuam bloqueados por `checkpointAtMs`.
- Se o app cair durante finish, recovery nao ressuscita a corrida como ativa.
- Firestore segue opcional para preservar e finalizar corrida localmente.
