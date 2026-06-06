# Instruções para IA no Projeto Wayper

Use este arquivo como fonte para configurar o Project/GPT do Wayper.

## Contexto

O Wayper é um app mobile de corrida gamificado. Usuários registram rotas reais, conquistam zonas no mapa, competem em rankings e acompanham evolução.

## Branches

- `develop`: desenvolvimento ativo.
- `main`: versão oficial/estável.

## Prioridade de fontes

1. Código atual do repositório na branch `develop`.
2. Código estável da branch `main`, quando a pergunta for sobre produção.
3. `README.md`.
4. Arquivos em `/docs`.
5. Issues e PRs.
6. Conhecimento geral, apenas quando faltar informação no projeto.

## Regras de resposta

Quando responder sobre o Wayper:

- Consulte o contexto do repositório antes de sugerir mudanças.
- Não invente estrutura se o código mostrar outra.
- Aponte arquivos prováveis de alteração.
- Separe solução rápida de solução bem feita.
- Quando algo não estiver definido, marque como suposição.
- Priorize segurança, privacidade e consistência dos dados.
- Não sugira expor credenciais, tokens ou arquivos `.env`.
- Não trate documentação antiga como verdade se ela contradiz o código.

## Regras técnicas

- Respeitar React Native/Expo.
- Respeitar Firebase Auth e Firestore.
- Respeitar MapLibre/OpenFreeMap.
- Usar Turf para geometrias quando fizer sentido.
- Testar regras críticas de corrida, zona e ranking.
- Cuidar de permissão de localização e falhas de GPS.
- Preservar a arquitetura local-first atual: corrida ativa em `wayper:activeRun:v2`, historico em `runs` via `sync.js`, sync de runs por `runSyncQueueService`.
- Preferir repositories/facades existentes antes de chamar Firestore em telas.
- Nao reativar `runService.js` legado nem `wayper_unsynced_runs_v2` como base nova.
- Nao adicionar SQLite sem ADR, medicao e plano incremental.

## Estilo de implementação

- Código pequeno e claro.
- Componentes visuais sem regra de negócio pesada.
- Serviços para Firebase, localização, ranking e zonas.
- Funções puras para cálculos críticos.
- Evitar dependência nova sem justificativa.

## Checklist para respostas com código

Antes de sugerir código, validar:

- Qual branch/contexto?
- Qual arquivo será alterado?
- Existe função/componente parecido?
- Isso afeta Firestore?
- Isso afeta permissão/localização?
- Precisa de teste?
- Precisa atualizar documentação?

## Prompt recomendado para o Project

```txt
Este projeto é o contexto central do Wayper.

Sempre que eu pedir algo relacionado ao código, documentação, arquitetura ou decisões do Wayper, use primeiro o repositório conectado no GitHub.

Priorize as fontes nesta ordem:
1. Código atual na branch develop.
2. Código estável na branch main.
3. README.md.
4. Documentação em /docs.
5. Issues e pull requests.
6. Conhecimento geral apenas quando faltar informação.

Ao sugerir mudanças:
- Respeite a estrutura atual do projeto.
- Indique arquivos que provavelmente precisam ser alterados.
- Separe solução rápida de solução robusta.
- Explique riscos técnicos.
- Não invente dependências sem justificar.
- Não exponha segredos, tokens ou credenciais.
- Atualize a documentação quando a mudança afetar regras, arquitetura, deploy ou dados.
```
