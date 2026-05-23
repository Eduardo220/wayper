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

## Build Android

### APK de produção

```bash
npm run prod:apk
```

### AAB de produção

```bash
npm run prod:aab
```

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
- Documentar assinatura Android.
- Documentar publicação na Play Store.
- Documentar rollback.
