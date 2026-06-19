# Backlog

Backlog vivo de funcionalidades, melhorias e pendencias. Nao usar este arquivo para reabrir como "a fazer" algo que ja existe na branch `develop`; nesses casos, o trabalho e validacao, hardening ou desacoplamento incremental.

## Alta prioridade

| Item | Tipo | Status | Observacao |
| --- | --- | --- | --- |
| Validacao real Android de corrida/background/notificacao | QA | Pendente | Repetir em aparelho fisico dev e release; emulador nao fecha o risco. |
| Assinatura Android release real | Build | Pendente | APK prod debug-signed nao e publicavel. |
| Source maps/Sentry autenticado | Observabilidade | Pendente | Precisa credenciais e evidencia no painel. |
| Feed/Friends/Groups local-first | Arquitetura | Pendente | Ainda ha chamadas Firestore-first em telas/services, incluindo grupos. |
| Regras de seguranca do Firestore | Seguranca | A validar | Firestore segue remoto/best effort e precisa regras consistentes. |
| Teste de volume AsyncStorage | Performance | A medir | Medir rotas/historico longos antes de decidir SQLite. |

## Media prioridade

| Item | Tipo | Status | Observacao |
| --- | --- | --- | --- |
| Sync remoto de stories | Social | Futuro | Hoje story local fica `PENDING_SYNC`. |
| Sync remoto de XP/conquistas | Gamificacao | Futuro | Base local existe; contrato remoto ainda nao. |
| Sync territorial remoto social/completo | Territorio | Futuro | Sync territorial continua separado do sync de runs. |
| Ranking remoto robusto | Ranking | Parcial | Repository diferencia fontes; agregados remotos ainda precisam contrato. |
| Amigos/grupos com cache/offline honesto | Social | Parcial | Nao mostrar demo/mock como dado real. |
| Limpeza de `console.*` legado | Qualidade | Pendente | Priorizar fora de fluxos criticos ja cobertos por logger. |

## Baixa prioridade

| Item | Tipo | Status | Observacao |
| --- | --- | --- | --- |
| Temas visuais | UI | Futuro | Depois dos fluxos reais. |
| Wireframes futuros | Design | Futuro | Manter Home social e dashboard pessoal separados. |
| Integracao com wearables | Feature | Futuro | Complexidade maior. |
| iOS producao | Plataforma | Futuro | Depende de prioridade e recursos. |

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

## Como priorizar

1. Primeiro, validar em aparelho real que corrida ativa, GPS, background, notificacao, recovery e finalizacao preservam dados.
2. Depois, fechar build release/sentry/assinatura.
3. Depois, desacoplar social/grupos do Firestore-first com repositories.
4. Depois, implementar sync remoto de stories, XP/conquistas e territorios.
5. Por ultimo, ampliar competicao, grupos e acabamento visual.
