# Fase C — segurança da corrida

**Data:** 2026-07-24  
**Branch:** `develop`  
**Base:** `bef386b`  
**Escopo executado:** gate automatizado, teste Android físico e remediação
**Status:** gate físico reprovado; correções aguardam nova build e reteste

## Diagnóstico

A fundação crítica permanece coberta por testes de tracking canônico,
finalização local-first, recovery, autosave, notificação e filas persistentes.
Nenhuma falha automatizada foi encontrada antes da Fase D.

Na descoberta inicial, um aparelho Android físico foi detectado:

```text
[serial omitido]  unauthorized  usb
```

Naquele momento, a chave ADB ainda não estava autorizada e nenhum comando foi
executado no aparelho. A autorização e o teste físico ocorreram depois, conforme
a nota posterior e o relatório de remediação.

## Arquivos analisados

- `AGENTS.md`;
- `docs/product/07-experiencia-durante-a-corrida.md`;
- `docs/product/08-relatorio-da-expedicao.md`;
- `docs/architecture/adrs-direcao-oficial.md`;
- `docs/12-guia-de-testes.md`;
- `docs/13-bugs-conhecidos.md`;
- `docs/22-teste-real-corrida-background.md`;
- tracking, finalização, recovery, notificação e filas cobertos pelas suites
  selecionadas.

## Arquivos alterados

- este relatório;
- `docs/13-bugs-conhecidos.md`, apenas para registrar a evidência do gate.

Nenhum arquivo de produção foi alterado na Fase C.

## Testes executados

Comando:

```bash
npm test -- --runInBand \
  src/services/runTracking/__tests__/activeRunTrackingService.test.js \
  src/services/run/__tests__/activeRunLocalFirst.integration.test.js \
  src/services/run/__tests__/runRecoveryService.test.js \
  src/services/run/__tests__/runAutoSaveService.test.js \
  src/services/run/__tests__/runNotificationService.test.js \
  src/services/run/__tests__/runDeferredTaskQueueService.test.js \
  src/services/run/__tests__/runSyncQueueService.test.js
```

Resultado:

- 7 suites aprovadas;
- 87 testes aprovados;
- 0 snapshots;
- 8,738 s informados pelo Jest.

Descoberta Android:

- `adb devices -l`: aparelho físico inicialmente detectado como `unauthorized`;
- `emulator -list-avds`: `Pixel_8_Funcional`.

## Riscos restantes

- `BUG-20260621-001` não pode ser marcado como corrigido;
- tela bloqueada e reentrada passaram parcialmente no Dev Client; ações da
  notificação, recovery e finalização falharam;
- kill, force-stop, preview/release e bateria agressiva continuam sem evidência;
- source maps/Sentry autenticado e assinatura release permanecem bloqueados;
- testes automatizados não reproduzem políticas reais de fabricantes Android.

## Validação física pendente

1. instalar a nova build Dev Client;
2. repetir as regressões de notificação, pausa, recovery e finalização;
3. repetir depois em preview/release e com economia agressiva;
4. anexar apenas diagnóstico sanitizado;
5. somente então atualizar o status dos bugs.

## Próximo passo

Retestar as remediações da Fase D antes de avançar para a camada visual do
Relatório da Expedição. O fluxo não será considerado validado em produção até a
matriz física ser concluída.

## Nota posterior

O aparelho foi autorizado e a matriz física parcial foi executada no Samsung
SM-A546E, Android 16/API 36. Tela apagada, foreground service e reentrada pela
notificação funcionaram, mas ações da notificação, consistência após
pausa/recovery e persistência da finalização falharam. O gate está reprovado até
uma nova build validar as correções. Evidência completa e sanitizada:
`docs/audits/2026-07-24-fase-cd-validacao-fisica-remediacao.md`.

## Commit sugerido

`docs(test): registrar gate automatizado da fase c`
