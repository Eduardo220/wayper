# Unidade 2 — checkpoint comprometido sem rebuild

**Data:** 2026-07-29
**Branch:** `develop`
**Base isolada:** `1d9bf2e`
**Origem:** `docs/product/direcao-estrategica-completa.md`
**Status:** implementada; automação aprovada; validação física pendente

## Objetivo

Persistir checkpoints ordinários de uma corrida `RUNNING` a partir do estado
já comprometido pelo pipeline canônico, sem normalizar, reconciliar ou copiar a
rota inteira outra vez.

A unidade preserva a regra de que tracking, checkpoint e recovery têm prioridade
absoluta. Lifecycle nativo, revalidação do runtime, cercas de finalização, modo
foco, histórico e sync permanecem fora deste commit.

## Diagnóstico anterior

O ponto já era filtrado e comprometido em memória, mas o checkpoint em lote
voltava ao caminho completo de normalização. Em corridas longas, isso repetia
trabalho sobre toda a geometria.

A revisão também encontrou riscos de durabilidade dentro do mesmo domínio:

- falhas de escrita de chunk ou índice eram registradas, mas absorvidas;
- o envelope leve podia avançar mesmo com chunks incompletos;
- depois de um reset, o cache dos descritores não era reidratado e todos os
  chunks eram sanitizados novamente;
- um chunk físico adiantado podia ser combinado com escalares de um envelope
  anterior;
- `current` válido era escolhido antes de avaliar um `backup` mais novo;
- JSON semanticamente inválido podia impedir o fallback para um backup saudável.

## Contrato fechado

### Fast path

O caminho comprometido só é elegível quando:

- o snapshot é o mesmo objeto da sessão e da revisão atuais;
- o estado é `RUNNING`;
- `activeRunId`, `runId` e `id` são coerentes;
- o schema é v2;
- aliases de trusted path, raw path e segmentos preservam identidade
  referencial;
- pontos confiáveis, pontos raw e distância não regrediram em relação ao último
  checkpoint durável.

O fast path atualiza duração e pace apenas por escalares e compartilha o mesmo
writer serializado do caminho normal. Legado v1, transições, recovery,
inconsistências, correção regressiva de distância ou revisão stale continuam no
fallback normalizado.

### Chunks e falhas parciais

- somente o chunk aberto ou alterado é sanitizado e regravado;
- falha de chunk ou índice interrompe a tentativa antes de
  `backup`/`current`/`meta`;
- o checkpoint continua dirty e pode ser repetido;
- os descritores do último envelope durável são o commit marker da geometria;
- se um chunk mutável contiver uma cauda posterior ainda não confirmada, recovery
  limita trusted/raw às contagens do descritor e recupera o último prefixo
  coerente;
- a leitura usa a chave canônica derivada de corrida + posição, sem confiar em
  uma chave arbitrária do descritor.

O `Map` interno de descritores só é restaurado quando identidade, versões,
chunk size, ordem, chave, contagens, `closed`, totais do índice, contagens do
envelope e geometria normalizada são integralmente coerentes. Caso contrário, o
cache volta vazio e a persistência segura regrava os chunks necessários.

### Current e backup

Os dois envelopes são lidos e validados antes da hidratação. A seleção:

- nunca cruza identidades de corrida;
- impede um estado vivo de vencer `FINISHING` ou `FINISHED`;
- usa a observação mais recente, incluindo `routeChunksIndex.updatedAt`;
- em empate com payload diferente da mesma corrida, respeita a ordem de escrita
  `backup -> current` e escolhe o backup;
- aceita correção canônica de distância menor;
- tenta o candidato alternativo somente quando ele possui a mesma identidade;
- rejeita objeto JSON sem identidade ou com aliases conflitantes.

## Complexidade honesta

O checkpoint deixa de reconstruir/copiar toda a geometria e limita a sanitização
ao chunk alterado. Ele não é O(1): ainda percorre descritores e segmentos,
serializa o índice e o envelope e executa I/O local.

## Arquivos analisados

- `AGENTS.md`;
- `README.md`;
- `docs/00-fontes-do-projeto.md`;
- `docs/product/README.md`;
- `docs/product/direcao-estrategica-completa.md`;
- ADR-027 e documentação de arquitetura/regras da corrida;
- auditorias das Fases 1A e 1B;
- serviço, estado, testes e integração local-first da corrida ativa.

## Arquivos alterados nesta unidade

- `src/services/runTracking/activeRunTrackingService.js`;
- `src/services/runTracking/__tests__/activeRunTrackingService.test.js`;
- `docs/12-guia-de-testes.md`;
- `docs/18-changelog-produto.md`;
- `docs/19-revisoes-de-implementacao.md`;
- este registro.

Nenhuma chave, schema persistido, fornecedor, SDK, tela ou domínio comercial foi
adicionado.

## Validações executadas

Gate focado na variante isolada sobre `HEAD`:

```bash
npm test -- --runInBand activeRunTrackingService.test.js activeRunLocalFirst.integration.test.js
```

Resultado: 2 suítes e 53 testes aprovados, 0 snapshots.

Suíte completa na mesma variante isolada:

```bash
npm test -- --runInBand
```

Resultado: 53 suítes e 536 testes aprovados, 0 snapshots.

Export Android isolado:

```bash
node scripts/with-env.cjs .env.development.local -- ./node_modules/.bin/expo export --platform android --output-dir /tmp/wayper-unit2-export.0kcrTk
```

Resultado: aprovado, 2.334 módulos e bundle Hermes de 10.926.920 bytes
(aproximadamente 10,9 MB).

Integridade do índice seletivo:

```bash
git diff --cached --check
```

Resultado: aprovado, sem erro de whitespace.

Os testes cobrem:

- identidade referencial da geometria no fast path;
- duração e pace escalares;
- fallback explícito de schema v1;
- correção anti-zigzag após checkpoint anterior;
- falha de chunk com retry;
- falha de índice seguida de reset antes do retry;
- prefixo conservador confirmado pelo descritor;
- current antigo com backup novo;
- backup de outra corrida;
- backup live antigo;
- empate com distância corrigida;
- backup terminal;
- current JSON sem identidade;
- recovery de 260 pontos sem regravar chunks íntegros;
- próximo checkpoint regravando apenas o chunk aberto;
- índice incoerente sem semear o cache incremental.

Não houve build nativo, instalação, deploy, teste em emulador ou aparelho físico.

## Riscos e validações pendentes

- a arquitetura atual usa chunks mutáveis; o commit marker garante o último
  prefixo confirmado, mas atomicidade da cauda mais recente exigiria chunks
  versionados/copy-on-write em decisão própria;
- latência, volume real do AsyncStorage, fallback, bateria e frequência de
  checkpoints precisam ser medidos em corrida longa real;
- tela apagada, kill, force-stop e fabricantes Android com economia agressiva
  continuam em validação;
- corrupção semântica arbitrária de chunks fora das janelas reais de escrita
  permanece tratada por recovery tolerante e cache conservador, mas não possui
  cobertura exaustiva.

## Rollback

Reverter somente o commit desta unidade devolve o checkpoint normalizado
anterior. As chaves, schema v2 e chunks existentes permanecem compatíveis; não
há migração destrutiva.

## Próxima unidade

Unidade 3 — lifecycle nativo serializado, mantendo modo foco, recovery de runtime
e cercas de finalização em commits posteriores.
