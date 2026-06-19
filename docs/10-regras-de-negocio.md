# Regras de Negócio

## Usuário

- Um usuário precisa estar autenticado para registrar corridas.
- Um usuário só pode editar o próprio perfil.
- Estatísticas públicas devem respeitar privacidade definida pelo produto.

## Corrida

- Uma corrida precisa ter início e fim.
- Uma corrida precisa ter distância mínima para ser considerada válida.
- Uma corrida precisa ter duração mínima para evitar registros acidentais.
- Pontos GPS com baixa precisão devem ser filtrados ou marcados.
- Corridas com comportamento impossível devem ser invalidadas ou revisadas.
- Pontos GPS devem ser classificados como `accepted`, `suspicious` ou `discarded`.
- `rawPath` e diagnostico; pode conter ponto que nao entra em metrica.
- `trustedPath` e a fonte de distancia, pace, XP, territorio e sync.
- `renderPath` e visual; suavizacao/simplificacao nao altera distancia.
- `segments` preserva pausas e gaps e nao deve conectar linha falsa.
- Lotes de background devem ser ordenados por timestamp antes de entrar no pipeline.

- Depois de finalizada e salva localmente, a corrida deve permanecer visivel no historico mesmo se o sync remoto estiver `PENDING_SYNC` ou `SYNC_FAILED`.
- Firestore e destino posterior de sincronizacao; falha remota nao pode apagar `localRunId`, rota, segmentos ou resumo territorial local.
- Retry de sync deve ser idempotente por `localRunId`/`remoteRunId` e nao pode duplicar corrida remota.

## XP, progresso e conquistas

Regras atuais obrigatorias:

- XP so pode ser aplicado depois que uma corrida finalizada valida foi salva localmente.
- Corrida ativa, `RUNNING`, `PAUSED`, `RECOVERING` ou `FINISHING` nao gera XP.
- Corrida descartada, cancelada, invalida, removida ou marcada como suspeita nao gera XP.
- A mesma corrida nao pode gerar o mesmo evento de XP duas vezes.
- A mesma conquista nao pode ser desbloqueada duas vezes para o mesmo usuario.
- Firestore indisponivel nao bloqueia XP, nivel ou conquistas locais.
- Dados demo/mock/medalhas visuais nao entram no progresso real.
- Corrida livre nao gera XP territorial, mesmo que payload legado tenha `area` ou campos territoriais.
- Corrida por zonas pode gerar XP territorial somente quando houver area/captura/celulas validas ja salvas pela corrida.
- Falha de territorio nao remove o XP basico da corrida valida.

Regra inicial de XP:

- Corrida valida concluida: 5 XP.
- Distancia: 1 XP a cada 100 m completos.
- Duracao: 1 XP a cada 10 min completos.
- Primeira corrida valida: +10 XP.
- Corrida por zonas valida: +5 XP.
- Territorio valido em corrida por zonas: `floor(areaM2 / 100) + 2 XP por celula capturada`, limitado a 500 XP por corrida.

Nivel:

- Nivel 1 inicia em 0 XP.
- Nivel 2 em 100 XP.
- Nivel 3 em 250 XP.
- Nivel 4 em 500 XP.
- Nivel 5 em 900 XP.
- Apos o nivel 5, o delta entre niveis cresce pelo fator 1.55.

## Zona conquistada

Regras a definir oficialmente:

- Como uma rota vira zona.
- Qual o tamanho mínimo de zona.
- Se zonas podem se sobrepor.
- Se um usuário pode conquistar território de outro.
- Se existe expiração ou disputa por tempo.
- Se zonas antigas podem ser atualizadas.

Regras atuais obrigatorias:

- Corrida livre nao gera zona/territorio e nao deve preservar `area`, `geometry`, `zoneCoords`, `territorySummary` ou eventos territoriais falsos.
- Corrida por zonas so gera territorio quando `territoryCaptureService` retorna captura valida.
- Captura territorial deve funcionar offline no nivel local e salvar em `wayper_territories_v1`.
- Eventos territoriais locais ficam em `wayper_territory_events_v1`.
- Leaderboards territoriais locais/cacheados ficam em `wayper_territory_leaderboards_v1`.
- `zones` e `@wayper_zones` sao legado; novo fluxo nao grava neles.
- A mesma corrida nao deve gerar captura duplicada.
- Falha de Firestore nao pode apagar territorio local nem esconder corrida no historico/detalhes.

## Ranking

- Ranking pode considerar área conquistada, quantidade de zonas e distância.
- Ranking deve ter período: global, semanal e mensal.
- Usuário inválido ou banido não deve aparecer.
- Corridas inválidas não devem pontuar.
- Atualização de ranking deve ser consistente para evitar manipulação.

- Ranking deve identificar origem de dados: `remote`, `cache`, `local`, `empty` ou `demo`.
- Cache remoto nao pode ser mostrado como ranking remoto atual e deve ter `updatedAt`/`cachedAt`.
- Ranking local deve usar somente dados locais reais e nao inventar usuarios adversarios.
- Demo/mock nunca pode ser fallback silencioso para erro remoto.

## Home social e stories

- Home/Início e social; dashboard pessoal fica fora da Home principal.
- Stories locais de corrida ficam em `wayper_run_stories_v1`.
- Story criado localmente usa `PENDING_SYNC` ate existir upload remoto real.
- Corrida ativa, pausada, recuperando ou `FINISHING` nao pode virar story.
- Feed/amigos/stories nao podem inventar usuarios, status online ou atividades demo.

## Sync e estados offline

- `PENDING_SYNC`, `SYNC_FAILED`, `LOCAL_ONLY`, `SYNCING` e `SYNCED` devem ser visiveis de forma honesta quando relevantes.
- Falha remota nao apaga dado local.
- Firestore e destino posterior/best effort nos fluxos local-first consolidados.
- Usuario offline deve ver local/cache/vazio, nao spinner infinito.

## Antifraude

Sinais suspeitos:

- Velocidade incompatível com corrida humana.
- Saltos de GPS muito grandes.
- Rota com poucos pontos e distância alta.
- Mudanças bruscas de localização.
- Corridas repetidas artificialmente.

## Grupos e amigos

A definir:

- Quem pode convidar.
- Quem pode ver estatísticas.
- Como ranking de grupo é calculado.
- Se grupos são públicos ou privados.

## Privacidade

- Não expor email publicamente.
- Não expor localização em tempo real para outros usuários sem regra clara.
- Histórico de rotas pode revelar casa/trabalho; tratar com cuidado.
- Permitir ocultar dados sensíveis deve ser considerado.
