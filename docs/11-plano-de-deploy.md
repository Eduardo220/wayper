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
npm run dev:android
npm run dev:phone
npm run rua
npm run prod:apk
npm run prod:aab
npm run prod:install
npm test
```

## Checklist antes de gerar build

- [ ] Instalar dependências com `npm install`.
- [ ] Rodar testes com `npm test`.
- [ ] Testar fluxo de login/cadastro.
- [ ] Testar permissão de localização.
- [ ] Testar corrida real ou simulada.
- [ ] Testar mapa.
- [ ] Testar salvamento no Firestore.
- [ ] Validar regras de segurança do Firebase.
- [ ] Conferir pacote Android correto.
- [ ] Conferir ambiente dev/prod.
- [ ] Conferir variáveis de ambiente.
- [ ] Remover logs sensíveis.
- [ ] Confirmar `EXPO_PUBLIC_APP_ENV` do profile.
- [ ] Confirmar `EXPO_PUBLIC_SENTRY_DSN` no ambiente correto.
- [ ] Confirmar `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT` nos secrets do build.
- [ ] Confirmar que o evento de teste nao contem coordenadas, rota, token, email ou telefone.

## Build Android

### Variaveis do Sentry

Runtime, expostas no bundle:

```bash
EXPO_PUBLIC_APP_ENV=development|staging|production
EXPO_PUBLIC_SENTRY_DSN=https://public-key@host/project-id
EXPO_PUBLIC_SENTRY_ENABLED=true
EXPO_PUBLIC_SENTRY_ENABLE_DEV=false
EXPO_PUBLIC_SENTRY_TEST_ENABLED=false
```

Build e upload de source maps:

```bash
SENTRY_AUTH_TOKEN=
SENTRY_ORG=wayper
SENTRY_PROJECT=react-native
```

`SENTRY_AUTH_TOKEN` deve existir apenas em secret local, CI ou EAS com visibilidade sensivel. Nao adicionar o token em `app.json`, `.env.example`, `sentry.properties` ou Git.

Os profiles EAS definem `EXPO_PUBLIC_APP_ENV`: development, staging para preview e production. Configure DSN, org, project e token separadamente nos ambientes usados pelo EAS.

### APK de produção

```bash
npm run prod:apk
```

### AAB de produção

```bash
npm run prod:aab
```

O script `android:flavors` injeta a etapa oficial `sentry.gradle` na pasta Android existente. O plugin `@sentry/react-native/expo` cobre prebuilds limpos. Em build release com credenciais configuradas, o upload de source maps e automatico.

Para gerar um release local sem upload, use temporariamente `SENTRY_DISABLE_AUTO_UPLOAD=true`. Esse build nao valida simbolicacao.

## Validacao do Sentry

1. Execute `npm run sentry:check` e confirme o plugin `@sentry/react-native/expo`.
2. Gere um build preview com DSN, org, project e token configurados.
3. Abra Configuracoes > Diagnostico.
4. Confirme status ativo, ambiente `staging` e DSN configurado `sim`.
5. Toque em `Enviar erro de teste para Sentry`.
6. No evento do Sentry, confira release, dist, ambiente, stack legivel e arquivo/linha original.
7. Pesquise o payload por `latitude`, `longitude`, `authorization`, email usado no teste e qualquer coordenada real. Nenhum valor cru deve aparecer.

Para validar source maps, use o evento controlado de um APK/AAB release ou preview, nunca apenas o Metro em development. O upload deve aparecer no log do build e o evento deve apontar para os arquivos-fonte, nao apenas para offsets minificados.

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
