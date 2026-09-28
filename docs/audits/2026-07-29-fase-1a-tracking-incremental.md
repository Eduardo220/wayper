# Fase 1A — tracking incremental e renderização de rota

Data: 2026-07-29

Status: implementada; automação aprovada; validação física pendente

## Objetivo

Fechar uma unidade pequena da fundação da corrida, alinhada à regra de que o
caminho crítico do GPS não recebe processamento pesado. Esta fase trata somente
da ingestão incremental, das métricas geométricas, da separação de segmentos e
da materialização explícita da rota visual.

Não fazem parte desta fase duração canônica, lifecycle nativo, recovery de
processo, finalização local-first, modo foco, histórico/sync ou produto
pós-corrida.

## Diagnóstico

A implementação local já movia distância, qualidade e caminhos para
acumuladores incrementais, mas a revisão encontrou falhas que impediam fechar a
unidade:

- a finalização ainda devolvia o vetor visual incremental completo em vez do
  render lazy simplificado;
- recovery seguido de `replace_previous` podia conservar velocidade máxima de
  um ponto removido;
- velocidade e aceleração retornadas após `replace_previous` podiam descrever
  arestas diferentes;
- o anti-zigzag podia cruzar a fronteira de pausa/gap e remover um ponto do novo
  segmento usando geometria do segmento anterior;
- `null` era convertido para zero e fazia accuracy ausente parecer perfeita;
- o cache visual tinha limite apenas por quantidade de entradas, mas aceitava
  colisões de serialização, cópia rasa e saídas acima de `maxPoints`;
- o snapshot ativo impedia uma correção legítima de distância ao usar o maior
  valor histórico depois da troca da cauda.

## Implementação fechada

- `rawPath`, `trustedPath`, distância, accuracy e velocidade máxima são
  atualizados incrementalmente durante a ingestão;
- rebuild completo fica restrito à hidratação/compatibilidade defensiva;
- smoothing e simplificação completos são executados somente em leitura
  explícita ou finalização, nunca a cada amostra GPS;
- a finalização materializa por segmento o mesmo render lazy exposto pela
  leitura explícita e respeita o limite de pontos;
- pausa, resume e gap preservam segmentos independentes também no filtro;
- a substituição anti-zigzag corrige distância, velocidade máxima, velocidade
  atual, aceleração e métricas de qualidade de forma coerente;
- números opcionais ausentes permanecem `null` durante a normalização;
- o cache é LRU com no máximo duas entradas, cópia profunda de dados canônicos,
  chave completa e bypass seguro para valores que não podem ser representados
  sem perda de tipo;
- `maxPoints` é limite estrito tanto no caminho normal quanto no fallback;
- o checkpoint em memória aceita redução de distância produzida por correção
  geométrica canônica.

Os vetores retornados pelo caminho hot são visões efêmeras, de somente leitura,
pertencentes à sessão. A identidade é reutilizada deliberadamente para evitar
cópia O(n) por amostra; retenção como snapshot imutável ou mutação externa não
faz parte do contrato.

## Arquivos da unidade

- `src/services/tracking/trackingFilters.js`;
- `src/services/tracking/trackingPathService.js`;
- `src/services/tracking/trackingRenderPath.js`;
- `src/services/tracking/index.js`;
- `src/services/tracking/__tests__/trackingPathService.test.js`;
- `src/services/tracking/__tests__/trackingRenderPathCache.test.js`;
- hunk de distância em
  `src/services/runTracking/activeRunTrackingService.js`;
- teste de integração correspondente em
  `src/services/runTracking/__tests__/activeRunTrackingService.test.js`.

## Validações executadas

Árvore atual:

```bash
npm test -- --runInBand \
  src/services/tracking/__tests__ \
  src/services/runTracking/__tests__/runTracking.test.js
```

Resultado: 3 suítes e 72 testes aprovados.

```bash
npm test -- --runInBand \
  src/services/runTracking/__tests__/activeRunTrackingService.test.js \
  src/services/tracking/__tests__/trackingPathService.test.js
```

Resultado: 2 suítes e 104 testes aprovados.

```bash
npm test -- --runInBand
```

Resultado final: 56 suítes e 593 testes aprovados, 0 snapshots.

Unidade aplicada isoladamente sobre `HEAD`, sem as demais mudanças do working
tree:

```bash
npm test -- --runInBand
```

Resultado final isolado: 53 suítes e 511 testes aprovados, 0 snapshots.

Bundle da árvore atual:

```bash
node scripts/with-env.cjs .env.development.local -- \
  ./node_modules/.bin/expo export --platform android \
  --output-dir /tmp/wayper-unit1a-current-export-20260729
```

Resultado: export Android aprovado, 2.335 módulos e bundle Hermes gerado.

## Riscos e validações pendentes

- falta teste em Android físico com GPS real, tela apagada, background,
  pausa/retomada e corrida longa;
- o cache ainda assina toda a entrada em trabalho explícito O(n), limitado a
  duas entradas; ele não participa do callback GPS;
- o contrato de visões hot exige consumo serializado e sem mutação; hoje o único
  consumidor de produção é o serviço canônico da corrida;
- não houve build nativo, deploy, release ou validação de bateria nesta fase.

## Próxima fase

Fase 1B — duração canônica. Antes de qualquer commit dessa unidade, corrigir o
caso em que `Math.max(durationMs armazenada, duração derivada)` reincorpora pausa
em snapshots v2 e definir o congelamento de `FINISHING`/`STOPPING`.

Rollback previsto: reverter somente o commit desta fase, sem tocar nas demais
mudanças ainda não separadas do working tree.
