# Plano de Deploy

## Objetivo

Definir como o Wayper sai do desenvolvimento para uma versão oficial estável.

## Branches

| Branch | Finalidade |
| --- | --- |
| `develop` | Ambiente de desenvolvimento e testes. |
| `main` | Versão oficial/produção. |

## Scripts conhecidos

Consultar `package.json` como fonte oficial. Alguns scripts importantes:

```bash
npm run dev
npm run dev:clean
npm run dev:android
npm run dev:phone
npm run rua
npm run prod:apk
npm run prod:apk:no-sourcemaps
npm run prod:aab
npm run prod:install
npm test
```

Aliases principais:

- `npm run dev`: ambiente development padrao, Metro localhost + emulador Android dev.
- `npm run dev:clean`: mesmo fluxo development, com cache do Metro limpo.
- `npm run dev:phone`: ambiente development em LAN + Android fisico conectado por USB.
- `npm run prod:apk`: ambiente production, APK prod release com upload Sentry quando credenciais existirem.
- `npm run prod:apk:no-sourcemaps`: ambiente production local com `SENTRY_DISABLE_AUTO_UPLOAD=true`; nao valida simbolicacao.

## Checklist antes de gerar build

- [ ] Instalar dependências com `npm install`.
- [ ] Rodar testes com `npm test`.
- [ ] Testar fluxo de login/cadastro.
- [ ] Testar permissão de localização.
- [ ] Testar corrida real ou simulada.
- [ ] Testar mapa.
- [ ] Testar salvamento local em `runs`.
- [ ] Testar sync posterior/best effort com Firestore sem duplicar corrida.
- [ ] Validar regras de segurança do Firebase.
- [ ] Conferir pacote Android correto.
- [ ] Conferir ambiente dev/prod.
- [ ] Conferir variáveis de ambiente.
- [ ] Remover logs sensíveis.
- [ ] Confirmar `EXPO_PUBLIC_APP_ENV` do profile.
- [ ] Confirmar `EXPO_PUBLIC_SENTRY_DSN` no ambiente correto.
- [ ] Confirmar `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT` nos secrets do build.
- [ ] Confirmar que o evento de teste nao contem coordenadas, rota, token, email ou telefone.

## Checklist Android real antes de release

- [ ] Rodar build dev em aparelho fisico.
- [ ] Rodar build release assinado corretamente em aparelho fisico.
- [ ] Conceder foreground location e validar inicio/retomada.
- [ ] Conceder/negociar background location e validar tela bloqueada.
- [ ] Conceder/negar notificacao Android 13+ e validar limitacao comunicada.
- [ ] Iniciar corrida, bloquear tela, voltar pelo app e pela notificacao.
- [ ] Pausar/retomar pelo app e pela notificacao.
- [ ] Matar app durante corrida e validar recovery.
- [ ] Finalizar offline e confirmar historico local `PENDING_SYNC`.
- [ ] Voltar internet e confirmar sync sem duplicata.
- [ ] Compartilhar `Imagem` e `Tracado PNG`; baixar deve pedir midia somente no clique.
- [ ] Criar story local e confirmar `PENDING_SYNC`.
- [ ] Exportar ZIP em `Configuracoes > Diagnostico` e validar dados mascarados.
- [ ] Validar Sentry/debug com evento controlado e source maps autenticados.

## Build Android

### Variaveis do Sentry

Runtime, expostas no bundle:

```bash
EXPO_PUBLIC_APP_ENV=development|preview|production
EXPO_PUBLIC_BUILD_PROFILE=development|preview|production
EXPO_PUBLIC_APP_VARIANT=dev|preview|production
EXPO_PUBLIC_APPLICATION_ID=com.wayper.app.dev|com.wayper.app
EXPO_PUBLIC_EAS_UPDATE_CHANNEL=
EXPO_PUBLIC_SENTRY_DSN=https://public-key@host/project-id
EXPO_PUBLIC_SENTRY_ENABLED=true
EXPO_PUBLIC_SENTRY_ENABLE_DEV=false
EXPO_PUBLIC_SENTRY_TEST_ENABLED=false
EXPO_PUBLIC_SENTRY_DEBUG=false
```

Build e upload de source maps:

```bash
SENTRY_AUTH_TOKEN=
SENTRY_ORG=wayper
SENTRY_PROJECT=react-native
```

`SENTRY_AUTH_TOKEN` deve existir apenas em secret local, CI ou EAS com visibilidade sensivel. Nao adicionar o token em `app.json`, `.env.example`, `sentry.properties` ou Git.

Os profiles EAS definem `EXPO_PUBLIC_APP_ENV`: `development`, `preview` e `production`, alem de `EXPO_PUBLIC_BUILD_PROFILE`, `EXPO_PUBLIC_APP_VARIANT` e `EXPO_PUBLIC_APPLICATION_ID`. Configure DSN, org, project e token separadamente nos ambientes usados pelo EAS.

### APK de produção

```bash
npm run prod:apk
```

### AAB de produção

```bash
npm run prod:aab
```

O script `android:flavors` injeta a etapa oficial `sentry.gradle` na pasta Android existente. O plugin `@sentry/react-native/expo` cobre prebuilds limpos. Em build release com credenciais configuradas, o upload de source maps e automatico.

Para gerar um release local sem upload, use `npm run prod:apk:no-sourcemaps`. Esse build injeta `SENTRY_DISABLE_AUTO_UPLOAD=true` e nao valida simbolicacao.

## Validacao do Sentry

1. Execute `npm run sentry:check-config` e confirme dependencia, plugin, Metro, Gradle e profiles EAS.
2. Gere um build preview com DSN, org, project e token configurados.
3. Abra Configuracoes > Diagnostico.
4. Confirme status ativo, ambiente `preview` e DSN configurado `sim`.
5. Toque em `Enviar erro de teste para Sentry`.
6. No evento do Sentry, confira release, dist, ambiente, stack legivel e arquivo/linha original.
7. Pesquise o payload por `latitude`, `longitude`, `authorization`, email usado no teste e qualquer coordenada real. Nenhum valor cru deve aparecer.

Para validar source maps, use o evento controlado de um APK/AAB release ou preview, nunca apenas o Metro em development. O upload deve aparecer no log do build e o evento deve apontar para os arquivos-fonte, nao apenas para offsets minificados.

Scripts uteis:

```bash
npm run sentry:check-config
npm run sentry:test
npm run sentry:upload-sourcemaps
```

`npm run sentry:test` nao envia evento sozinho nem imprime token. Ele orienta a usar o botao controlado em `Configuracoes > Diagnostico`. Para EAS Update, quando o projeto passar a usar updates publicados, use o fluxo autenticado correspondente:

```bash
eas update --branch <branch>
npm run sentry:upload-sourcemaps
```

Se `SENTRY_AUTH_TOKEN` nao estiver disponivel em build local, `SENTRY_DISABLE_AUTO_UPLOAD=true` pode gerar artefato para teste local, mas esse artefato nao prova simbolicacao.

Checklist extra para investigar congelamento pelo painel Sentry:

- Filtrar por `event=RUN_UI_POSSIBLE_FREEZE_DETECTED`, `MAP_RENDER_STALL_DETECTED`, `ACTIVE_RUN_MISSING_AFTER_FOREGROUND`, `RUN_NOTIFICATION_OPEN_RESTORE_STARTED`, `RUN_RECONCILE_FAILED` e `ACTIVE_RUN_SAVE_FAILED`.
- Conferir tags `release`, `dist`, `environment`, `buildProfile`, `appVariant`, `platform`, `runStatus` e `screenName`.
- Abrir breadcrumbs e confirmar a ordem: start/countdown, permissao, watcher foreground/background, notificacao, AppState, restore/reconcile, snapshot canonico aplicado, UI/map render.
- Comparar `sentryEventId` com o ZIP local exportado pelo Diagnostico quando o usuario conseguir compartilhar evidencia.
- Procurar por coordenadas, rota, token, email e Firebase payload cru no evento; qualquer vazamento bloqueia release.

## Estado validado em 12/06/2026

- `npm test`: 41 suites e 381 testes aprovados.
- `android:build:dev`: aprovado.
- `android:build:prod`: bundle e source map gerados. Sem credenciais, a etapa autenticada de upload foi executada e falhou informando que `SENTRY_ORG`/token eram obrigatorios.
- `SENTRY_DISABLE_AUTO_UPLOAD=true npm run android:build:prod`: aprovado para validar o APK local sem upload.
- Source map `prodRelease`: 2.289 fontes originais, incluindo os modulos de monitoring.
- Upload de source maps: nao validado no servidor porque `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT` nao estavam disponiveis no ambiente local. A tarefa nao ficou silenciosamente `SKIPPED`: tentou enviar e bloqueou o build sem credenciais.
- Android fisico: APK dev instalado e app aberto sem crash em um Samsung SM-A546E.
- Sentry em runtime: envelopes enviados com sucesso; breadcrumbs automaticos de `console.*` foram bloqueados depois de a validacao revelar que o SDK os capturava por padrao.
- Botao controlado de Diagnostico: enviou o evento `Wayper controlled Sentry test event` sem derrubar o app. O evento foi agrupado no issue `REACT-NATIVE-1`, com ambiente `development`, release `com.wayper.app@1.0.0+1` e dist `1`.
- Sanitizacao do stack trace: a primeira tentativa revelou truncamento excessivo das frames. O limite foi corrigido, testado e a repeticao no Android foi enviada sem erro de desserializacao.
- Privacidade em runtime: a serializacao local do evento corrigido nao continha latitude, longitude, rota, tokens, email, Firebase Auth cru, NDJSON, ZIP ou breadcrumbs de `console.*`. `userId` apareceu anonimizado.
- Corrida em tela bloqueada: o foreground service permaneceu ativo por 125 segundos; 36 localizacoes foram processadas localmente e nenhum evento Sentry foi criado por ponto GPS. Pausa e retomada pela mesma action nativa da notificacao funcionaram.
- A corrida ficou pausada porque o keyguard seguro do aparelho exige desbloqueio manual. Finalizacao, salvamento e nova exportacao do ZIP nao foram concluidos nesta rodada.
- Painel Sentry e simbolicacao final: a notificacao de alerta confirmou projeto, issue, release, dist e usuario anonimo, mas a inspecao autenticada do payload e a confirmacao de arquivo/linha original continuam pendentes.

## Estado consolidado em 19/06/2026

- `npm test -- --runInBand`: reportado como aprovado com 49 suites / 428 testes.
- `git diff --check`: reportado como aprovado, mantendo apenas warnings LF/CRLF conhecidos quando aplicavel.
- `.\gradlew.bat :app:compileDevDebugKotlin --console=plain`: reportado como aprovado.
- Checagem estatica simples de imports relativos: 234 arquivos verificados.
- Scripts `lint`, `typecheck`, `test:ci` e `validate` nao existem no `package.json`.
- Esta validacao nao substitui teste real em aparelho fisico para GPS/background/notificacao/recovery/share.

### Assinatura Android

O `prodRelease` local ainda usa `signingConfigs.debug`. A verificacao com `apksigner` confirmou o certificado `CN=Android Debug`.

Risco: esse APK nao pode ser tratado como artefato oficial de publicacao. Antes da Play Store, configurar credencial release real via EAS Credentials ou propriedades/secret seguros no CI e repetir `apksigner verify --print-certs`.

Nao armazenar keystore, alias ou senhas no repositorio. A alteracao da assinatura deve ser feita em uma tarefa separada, pois o fluxo nativo atual e gerado e parcialmente ignorado pelo Git.

### Auditoria npm

Depois de `npm audit fix` sem `--force`:

- 0 critical, 0 high, 23 moderate no total.
- 16 moderate com `--omit=dev`.
- `concurrently` foi atualizado para remover o advisory critico de `shell-quote`.
- `firebase-admin` foi movido para `devDependencies`, pois e usado apenas por `scripts/initFirestore.js`, e atualizado dentro da major 13.
- As pendencias restantes exigem Expo 56 ou `firebase-admin` 14 segundo o npm. Nao aplicar `--force`; tratar essas majors em upgrades separados com validacao nativa completa.

## Promoção para produção

1. Finalizar feature na branch própria.
2. Fazer merge para `develop`.
3. Testar versão em `develop`.
4. Abrir PR de `develop` para `main`.
5. Revisar checklist.
6. Gerar build oficial.
7. Criar tag de versão, se aplicável.

## Versionamento sugerido

```txt
vMAJOR.MINOR.PATCH
```

Exemplos:

```txt
v0.1.0
v0.2.0
v1.0.0
```

## Pendências

- Definir estratégia de CI/CD.
- Definir se usará EAS Build como padrão.
- Configurar e validar assinatura Android release real.
- Validar upload autenticado de source maps e simbolicacao no painel Sentry.
- Repetir evento controlado e corrida com tela bloqueada em dispositivo fisico.
- Documentar publicação na Play Store.
- Documentar rollback.
