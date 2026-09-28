# Fase C — segurança da corrida

**Data:** 2026-07-24  
**Branch:** `develop`  
**Base:** `bef386b`  
**Escopo executado:** gate automatizado, teste Android físico e remediação
**Status:** registro original reprovado; reteste posterior aprovou o subfluxo
curto no app e manteve o gate físico global aberto

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
- na execução original, tela bloqueada e reentrada passaram parcialmente no Dev
  Client; ações da notificação, recovery e finalização falharam;
- kill, force-stop, preview/release e bateria agressiva continuam sem evidência;
- source maps/Sentry autenticado e assinatura release permanecem bloqueados;
- testes automatizados não reproduzem políticas reais de fabricantes Android.

## Validação física pendente

1. repetir pausa/retomada pela notificação e reentrada com tela bloqueada;
2. validar recovery, falha induzida, rota real e histórico após reinício;
3. repetir depois em offline, preview/release e com economia agressiva;
4. anexar apenas diagnóstico sanitizado;
5. atualizar cada bug somente para o escopo efetivamente comprovado.

## Próximo passo

Concluir a matriz física restante antes de considerar o fluxo validado em
produção. O reteste curto posterior comprovou somente pausa/retomada e
finalização no app.

## Nota posterior

O aparelho foi autorizado e a matriz física parcial foi executada no Samsung
SM-A546E, Android 16/API 36. Tela apagada, foreground service e reentrada pela
notificação funcionaram, mas ações da notificação, consistência após
pausa/recovery e persistência da finalização falharam naquela execução. Uma
nova build aprovou depois o subfluxo curto de pausa/retomada e finalização no
app; o gate global permanece aberto. Evidência completa e sanitizada:
`docs/audits/2026-07-24-fase-cd-validacao-fisica-remediacao.md`.

## Commit sugerido

`docs(test): registrar gate automatizado da fase c`
