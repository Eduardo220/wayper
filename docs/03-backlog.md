# Backlog

Backlog vivo de funcionalidades, melhorias e pendencias. Nao usar este arquivo para reabrir como "a fazer" algo que ja existe na branch `develop`; nesses casos, o trabalho e validacao, hardening ou desacoplamento incremental.

## Alta prioridade

| Item | Tipo | Status | Observacao |
| --- | --- | --- | --- |
| Retestar correções de corrida/background/notificação | QA | Alta | Gate Dev Client reprovado em 2026-07-24; gerar nova build e repetir ações da notificação, pausa, recovery e finalização. |
| Validar finalização/reentrada em Android preview/release | QA/bug | Pendente | Dev Client revelou falhas e recebeu correções; ainda falta confirmar histórico, lock e rota sem duplicação em nova build. |
| Modo foco da corrida | Produto/UX | Planejado | Tempo, distância, pace, estado, GPS crítico e controles; mapa opcional. |
| Contrato do Relatório da Expedição | Produto/dados | Planejado | Reabrível, parcial e compatível com `RunSummaryModal`/`RunDetailScreen`. |
| Assinatura Android release real | Build | Pendente | APK prod debug-signed nao e publicavel. |
| Source maps/Sentry autenticado | Observabilidade | Pendente | Precisa credenciais e evidencia no painel. |
| Feed/Friends/Groups local-first | Arquitetura | Pendente | Ainda ha chamadas Firestore-first em telas/services, incluindo grupos. |
| Regras de seguranca do Firestore | Seguranca | A validar | Firestore segue remoto/best effort e precisa regras consistentes. |
| Teste de volume AsyncStorage | Performance | Em validação | Caso real atingiu limite padrão; schema compacto v2 e limite Android de 32 MB precisam medição antes de decidir SQLite. |

## Media prioridade

| Item | Tipo | Status | Observacao |
| --- | --- | --- | --- |
| Sync remoto de stories | Social | Futuro | Hoje story local fica `PENDING_SYNC`. |
| Sync remoto de XP/conquistas | Gamificacao | Futuro | Base local existe; contrato remoto ainda nao. |
| Sync territorial remoto social/completo | Territorio | Futuro | Sync territorial continua separado do sync de runs. |
| Ranking remoto robusto | Ranking | Parcial | Repository diferencia fontes; agregados remotos ainda precisam contrato. |
| Amigos/grupos com cache/offline honesto | Social | Parcial | Nao mostrar demo/mock como dado real. |
| Limpeza de `console.*` legado | Qualidade | Pendente | Priorizar fora de fluxos criticos ja cobertos por logger. |
| Consolidar regras territoriais competitivas | Produto | Pendente | Código e documentação histórica divergem sobre disputa/posse. |
| Feature flags centralizadas | Arquitetura | Planejado | Necessárias antes de relatório novo e integrações comerciais. |

## Baixa prioridade

| Item | Tipo | Status | Observacao |
| --- | --- | --- | --- |
| Temas visuais | UI | Futuro | Depois dos fluxos reais. |
| Wireframes futuros | Design | Futuro | Manter Home social e dashboard pessoal separados. |
| Integracao com wearables | Feature | Futuro | Complexidade maior. |
| iOS producao | Plataforma | Futuro | Depende de prioridade e recursos. |
| Wayper Plus/entitlements | Negócio | Aprovado conceitualmente | Só depois da fundação, pipeline e relatório. |
| Parceiros/desafios/eventos | Ecossistema | Aprovado conceitualmente | Fora da corrida e sem integração nesta fase. |
| Ads/gateway/pagamentos | Monetização | Não autorizado agora | Exigem providers, política, consentimento, flags e decisão específica. |

## Concluido/avancado e ainda monitorado

| Item | Status | Observacao |
| --- | --- | --- |
| Corrida ativa local-first | Avancado | `wayper:activeRun:v2` canonico; recovery/autosave consolidados. |
| GPS/path | Avancado | `rawPath`, `trustedPath`, `renderPath`, `segments`. |
| Historico/detalhes offline | Avancado | Fonte `runs`. |
| Sync idempotente de runs | Avancado | `sync.js`/`runSyncQueueService`. |
| Territorios locais | Avancado | `wayper_territories_v1` e eventos/leaderboards locais. |
| XP/conquistas locais | Inicial avancado | Sync remoto futuro. |
| Perfil/ranking local/cache | Avancado | Origens explicitas. |
| Home social inicial | Avancado | `socialHomeRepository`; sem dashboard pessoal na Home. |
| Onboarding/permissoes/estados vazios | Avancado | Sem prompt infinito; estados compartilhados. |
| Compartilhamento imagem/trace PNG/story local | Avancado | Sem copiar imagem ate suporte confiavel. |
| Diagnostico local/export ZIP | Avancado | Funciona offline e mascara coordenadas por padrao. |
| Contrato do salvamento mínimo | Implementado | `runFinalizationService` confirma `minimumSavedRunVersion=1` antes de limpar a sessão ativa. |
| Orquestração de finalização fora da tela | Implementado | `MapScreen` comanda o serviço; lock/idempotência não dependem do componente. |
| Núcleo do pipeline da Expedição | Implementado | A fila existente persiste resultado/status por módulo e reconcilia seeds pendentes no startup. |

## Como priorizar

1. Primeiro, validar em aparelho real que corrida ativa, GPS, background, notificacao, recovery e finalizacao preservam dados.
2. Depois, validar e endurecer a finalização mínima e o pipeline já extraídos.
3. Depois, entregar o Relatório da Expedição e modo foco por rollout reversível.
4. Em paralelo apenas quando não aumentar risco, fechar build, Sentry e assinatura.
5. Depois, desacoplar social/grupos e ampliar retenção.
6. Só então implementar entitlements/Plus.
7. Parceiros, anúncios e pagamentos exigem fases próprias e autorização explícita.
