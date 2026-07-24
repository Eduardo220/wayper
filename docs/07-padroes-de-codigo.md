# Padrões de Código

## Branches

| Branch | Regra |
| --- | --- |
| `develop` | Desenvolvimento ativo. |
| `main` | Versão oficial/estável. |
| `feature/nome-da-feature` | Funcionalidades novas. |
| `fix/nome-do-bug` | Correções. |
| `docs/nome` | Documentação. |
| `refactor/nome` | Refatorações sem mudar comportamento. |

## Fluxo de trabalho

1. Criar branch a partir de `develop`.
2. Fazer commits pequenos e claros.
3. Testar localmente.
4. Abrir PR para `develop`.
5. Revisar e validar.
6. Só promover para `main` quando a versão estiver estável.

## Commits

Formato recomendado:

```txt
tipo: descrição curta
```

Tipos sugeridos:

- `feat`: nova funcionalidade.
- `fix`: correção.
- `docs`: documentação.
- `refactor`: melhoria interna sem alterar comportamento.
- `test`: testes.
- `chore`: tarefas de manutenção.
- `build`: build/configuração.
- `ci`: integração contínua.

Exemplos:

```txt
feat: adicionar tela de ranking
fix: corrigir cálculo de distância da corrida
docs: adicionar modelo de dados inicial
```

## Organização de código

A estrutura real deve seguir o repositório. Caso precise padronizar, sugestão:

```txt
src/
  components/
  screens/
  navigation/
  services/
  hooks/
  utils/
  constants/
  types/
  features/
```

## Nomes

- Componentes React: `PascalCase`.
- Funções e variáveis: `camelCase`.
- Constantes globais: `UPPER_SNAKE_CASE`.
- Arquivos de componente: `PascalCase`.
- Arquivos utilitários: `camelCase` ou `kebab-case`, escolher um e manter.

## Regras práticas

- Não duplicar lógica de cálculo de corrida.
- Não misturar regra de negócio pesada dentro de componente visual.
- Não expor chave privada ou credencial.
- Não escrever direto no Firestore sem validar permissão e estrutura.
- Nao criar service, hook, repository ou storage paralelo quando ja existir facade/service oficial.
- Preservar os caminhos local-first atuais: `activeRunTrackingService`/`activeRunState`, `sync.js`/`runSyncQueueService`, repositories e storages oficiais.
- Tratar Firestore como remoto/best effort nos fluxos ja consolidados, nunca como requisito para preservar corrida, historico, share, diagnostico, XP/conquistas ou Home social.
- Nao reativar `runService.js`, `zones`/`@wayper_zones`, `xpService` ou `MedalsWidget` como fonte oficial sem ADR e migracao explicita.
- Demo/mock deve carregar origem explicita e nunca substituir dado real/cache/local silenciosamente.
- Preferir funções pequenas e testáveis.
- Código de mapa e GPS deve tratar erro, permissão negada e dados imprecisos.
- Não executar território, XP, ranking, recompensa, anúncio ou rede no caminho de
  alta frequência do GPS.
- Lógica crítica de tracking/finalização deve sobreviver sem componente montado.
- Trabalho derivado precisa de idempotency key, estado persistente, retry limitado
  e erro classificável.
- Evoluir `runDeferredTaskQueueService`; não criar outra fila de Expedição em
  paralelo.
- UI apresenta estado e dispara comando; não concede recompensa nem confirma
  pagamento.
- Entitlements, feature flags e política de anúncios devem ser resolvidos
  centralmente quando forem implementados.
- Imports de Firebase, gateway, ads e analytics ficam em adapters/repositories,
  não em regras de domínio.
- Toda feature futura declara status de produto, modo offline, rollback e impacto
  na corrida antes de receber código.

## Scripts importantes

Consultar `package.json` como fonte oficial. Scripts conhecidos incluem:

- `npm start`
- `npm test`
- `npm run dev`
- `npm run dev:clean`
- `npm run dev:android`
- `npm run dev:phone`
- `npm run rua`
- `npm run prod:apk`
- `npm run prod:apk:no-sourcemaps`
- `npm run prod:aab`
