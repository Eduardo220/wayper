# Problemas conhecidos e riscos técnicos

## Objetivo

Este arquivo registra riscos, problemas técnicos e limitações conhecidas. Itens daqui devem ser revisados antes de features que dependam de GPS, mapa, Firestore, território, XP ou ranking.

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

