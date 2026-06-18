# Onboarding, permissoes e estados vazios

## Objetivo

Garantir que usuario novo, offline ou com remoto indisponivel consiga entender o Wayper, navegar pelas principais telas e iniciar corrida somente quando a permissao essencial existir.

## Onboarding

- O onboarding e local-first e usa `wayper:onboarding:v1:completed`.
- Ele aparece apos login quando nao existe corrida ativa preservada.
- Ele explica corrida real, territorio, amigos/stories, modo offline, localizacao, background location e notificacao.
- Ele nao pede permissao nativa de localizacao, notificacao ou midia.
- Ao concluir, o app salva o marcador local e nao mostra novamente.

## Politica de permissoes

| Permissao | Onde e pedida | Obrigatoria | Momento | Se negar |
| --- | --- | --- | --- | --- |
| Localizacao foreground | `MapScreen` por `permissions.ensureLocationForRun()` | Sim para iniciar corrida | Ao tentar iniciar/retomar corrida ou pela acao do aviso de mapa | Inicio/retomada bloqueado; usuario ve acao para tentar de novo ou abrir configuracoes |
| Localizacao background | `MapScreen` por `permissions.requestBackgroundLocation()` | Opcional/limitante | Durante corrida, antes de prometer tela bloqueada/background | Corrida continua limitada; tela bloqueada pode registrar menos pontos; se bloqueada, abrir configuracoes |
| Notificacoes Android | `MapScreen` por `permissions.requestNotificationPermission()` e `runNotificationService` para foreground service | Opcional/limitante | Ao iniciar/usar corrida persistente | Corrida continua; controles pela notificacao podem nao aparecer; se bloqueada, abrir configuracoes |
| Midia/galeria | Perfil, resumo e compartilhamento por `requestImageLibraryPermission`/`requestMediaPermission` | Opcional | Somente ao escolher/salvar/compartilhar imagem | Fluxo de imagem e bloqueado, app continua funcional |
| Camera | Nao usada no fluxo atual | Nao | Nao pedir | Nao aplicavel |
| Storage/arquivos | Declaracoes Android legadas para salvar/compartilhar arquivos | Opcional | Somente em export/share quando necessario pela plataforma | Mostrar erro claro de imagem/exportacao |
| Internet | Declarada no Android | Nao para abrir telas local-first | Uso remoto/cache/sync | Mostrar local/cache/vazio; nunca promover demo como real |
| Foreground service Android | Declarada para corrida ativa | Suporte tecnico | Ao iniciar notificacao persistente da corrida | Se indisponivel, corrida segue local-first com limitacao comunicada |

## Facade oficial

`src/services/permissions.js` e a facade oficial. Ela concentra:

- `checkLocationPermission`
- `requestForegroundLocation`
- `requestBackgroundLocation`
- `checkNotificationPermission`
- `requestNotificationPermission`
- `openAppSettings`
- `getPermissionSummary`
- `shouldShowPermissionEducation`
- `markPermissionEducationSeen`
- `normalizePermissionStatus`

Regras:

- Checar status pode acontecer em foco/mount.
- Request nativo deve vir de acao explicita ou da preflight de inicio de corrida.
- Educacao aparece uma vez por permissao.
- Permissao opcional negada nunca bloqueia o app inteiro.
- Foreground location negada bloqueia inicio de corrida.

## Estados vazios e offline

Componentes globais ficam em `src/components/states`:

- `EmptyState`
- `ErrorState`
- `OfflineState`
- `PermissionState`
- `LoadingState`
- `RetryState`

Mensagens padrao:

- "Voce esta offline, mostrando dados locais."
- "Salvo localmente, sincroniza depois."
- "Feed remoto indisponivel, tente novamente mais tarde."
- "Corrida preservada no aparelho."

Por tela:

- Home: sem stories/feed/amigos deve sugerir mapa, amigos ou story sem dados demo.
- Mapa: localizacao foreground negada bloqueia corrida; background/notificacao negadas viram limitacao.
- Historico: sem corridas explica que corridas finalizadas aparecem ali e seguem salvas localmente.
- Detalhe: corrida ausente mostra erro claro e nao spinner infinito.
- Perfil: cache/local e conquistas iniciais aparecem sem Firestore obrigatorio.
- Ranking: `remote`, `cache`, `local`, `empty` e `demo` continuam explicitados; demo nao e fallback silencioso.
- Compartilhamento: midia negada bloqueia apenas salvar/baixar imagem.

## Checklist manual

- [ ] Instalar app limpo.
- [ ] Abrir onboarding e concluir.
- [ ] Reabrir app e confirmar que onboarding nao reaparece.
- [ ] Negar localizacao foreground e tentar iniciar corrida.
- [ ] Confirmar bloqueio com acao para permitir/configuracoes.
- [ ] Permitir foreground e iniciar corrida.
- [ ] Ver aviso educativo de background antes do pedido nativo.
- [ ] Negar background e confirmar aviso de corrida limitada.
- [ ] Negar notificacao e confirmar que corrida nao quebra.
- [ ] Abrir Home sem feed/stories/amigos e confirmar estados honestos.
- [ ] Abrir Historico sem corridas.
- [ ] Abrir Perfil sem dados remotos.
- [ ] Abrir Ranking offline/cache/local.
- [ ] Gerar corrida offline e confirmar mensagem local/sync posterior.
- [ ] Confirmar que nenhum mock/demo aparece como dado real.

## Limites conhecidos

- Android pode encerrar background mesmo com permissao e foreground service em aparelhos com economia agressiva.
- Sem background location, o app nao promete coleta confiavel com tela bloqueada.
- Sem notificacao no Android 13+, a corrida local-first pode continuar, mas controles fora do app ficam limitados.
