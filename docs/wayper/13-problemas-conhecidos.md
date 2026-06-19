# Problemas conhecidos e riscos técnicos

## Objetivo

Este arquivo registra riscos, problemas técnicos e limitações conhecidas. Itens daqui devem ser revisados antes de features que dependam de GPS, mapa, Firestore, território, XP ou ranking.

## Riscos atuais da rodada local-first

- Background/tela bloqueada ainda exige validacao fisica Android em build dev e release.
- Fabricantes com economia agressiva de bateria podem matar processo mesmo com foreground service.
- Feed/Friends/Groups ainda possuem trechos Firestore-first; novas alteracoes devem desacoplar por repositories/fallbacks locais.
- Stories locais ficam `PENDING_SYNC`; upload/sync remoto ainda e futuro.
- XP/conquistas locais nao possuem sync remoto completo.
- Sync territorial remoto/social completo ainda e futuro e segue separado do sync de runs.
- AsyncStorage pode pesar com historicos e rotas muito longos; SQLite depende de medicao real.
- `runService.js`, `locationService`, `zonesStorage`, `zoneService`, `xpService` e `MedalsWidget` seguem legados e nao devem ser reativados como fonte oficial.
- `console.*` legado ainda existe fora de fluxos criticos; migrar gradualmente para `logger.js`.
- Source maps/Sentry autenticado e assinatura release real seguem pendentes antes de tratar release como publicavel.

## GPS impreciso

Risco:

- Pontos ruins podem gerar distância errada e território injusto.

Impactos:

- Conquista de território.
- XP.
- Ranking futuro.
- Confiança do usuário.

Mitigação inicial:

- Filtrar pontos por precisão.
- Separar trechos com saltos.
- Mostrar alerta quando GPS estiver ruim.

## Custo do Firestore

Risco:

- Gravar muitos pontos GPS pode gerar custo alto.

Impactos:

- Escalabilidade.
- Histórico.
- Ranking.
- Sincronização.

Mitigação inicial:

- Separar resumo de rota detalhada.
- Compactar ou simplificar rotas.
- Evitar leituras de rota completa em listas.
- Avaliar escrita por ponto antes de implementar.

## Performance do mapa

Risco:

- Rotas, polígonos e territórios podem deixar o mapa lento.

Impactos:

- Tela principal.
- Atividade ativa.
- Histórico.
- Resumo.

Mitigação inicial:

- Renderizar apenas dados necessários.
- Simplificar geometria.
- Paginar ou limitar histórico no mapa.
- Evitar polígonos complexos no MVP.

## Bateria

Risco:

- GPS de alta precisão consome bateria rapidamente.

Impactos:

- Atividades longas.
- Uso em segundo plano.
- Retenção do usuário.

Mitigação inicial:

- Ativar alta precisão somente durante atividade.
- Reduzir coleta durante pausa.
- Evitar coleta permanente fora da atividade.
- Monitorar comportamento em dispositivos reais.

## Trapaças

Risco:

- Usuários podem simular localização ou registrar deslocamentos impossíveis.

Impactos:

- XP.
- Ranking.
- Território.
- Clans futuros.

Mitigação inicial:

- Validar velocidade plausível.
- Detectar saltos.
- Marcar atividades suspeitas.
- Evitar competição forte no MVP.

## Complexidade de território

Risco:

- Regras de conquista podem ficar difíceis de explicar, calcular e renderizar.

Impactos:

- Entendimento do usuário.
- Firestore.
- Mapa.
- Performance.
- Desenvolvimento.

Mitigação inicial:

- Escolher uma mecânica simples.
- Separar conquista individual de disputa.
- Documentar pontos em aberto.
- Adiar posse competitiva.

## Atividade em segundo plano

Risco:

- Sistemas operacionais podem limitar coleta de localização em segundo plano.

Impactos:

- Rotas incompletas.
- Perda de confiança.
- Dados inconsistentes.

Mitigação inicial:

- Solicitar permissões corretas.
- Recuperar estado ao reabrir app.
- Informar limitações ao usuário.
- Testar em Android e iOS antes de tratar como estável.

## Persistência local de corridas longas

Risco:

- A camada offline inicial usa AsyncStorage, que já é o padrão atual do projeto, mas pode ficar pesada se atividades longas acumularem muitos pontos GPS.

Impactos:

- Tempo de escrita local.
- Uso de memória ao serializar a rota.
- Recuperação de atividade ativa.
- Histórico local.

Mitigação inicial:

- Limitar o volume de pontos persistidos na corrida ativa.
- Manter rota final com caps já usados pelo app.
- Adiar escrita remota para a fila de sincronização.
- Migrar `runOfflineStorageService` para SQLite/Expo SQLite se testes de rua mostrarem volume alto ou escrita lenta.

## Privacidade de localização

Risco:

- Rotas podem revelar casa, trabalho e hábitos do usuário.

Impactos:

- Segurança pessoal.
- Compartilhamento futuro.
- Feed social.
- Ranking por mapa.

Mitigação inicial:

- Evitar feed social no MVP.
- Não tornar rotas públicas por padrão.
- Planejar modo privado antes de recursos sociais.

## Documentos relacionados

- [[03-mecanica-territorios]]
- [[05-gps-e-validacao]]
- [[08-firebase-firestore]]
- [[09-arquitetura-tecnica]]
