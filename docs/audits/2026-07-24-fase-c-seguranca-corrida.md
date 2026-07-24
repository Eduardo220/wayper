# Fase C — segurança da corrida

**Data:** 2026-07-24  
**Branch:** `develop`  
**Base:** `bef386b`  
**Escopo executado:** gate automatizado e descoberta do ambiente Android  
**Status:** automatizado aprovado; validação física pendente por autorização ADB

## Diagnóstico

A fundação crítica permanece coberta por testes de tracking canônico,
finalização local-first, recovery, autosave, notificação e filas persistentes.
Nenhuma falha automatizada foi encontrada antes da Fase D.

Um aparelho Android físico foi detectado:

```text
RQCW306MRLM  unauthorized  usb:1-6
```

Como a chave ADB ainda não foi autorizada no aparelho, nenhum comando foi
executado nele. O emulador `Pixel_8_Funcional` existe, mas não substitui a matriz
física de bloqueio de tela, foreground service e economia de bateria.

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

- `adb devices -l`: aparelho físico detectado, mas `unauthorized`;
- `emulator -list-avds`: `Pixel_8_Funcional`.

## Riscos restantes

- `BUG-20260621-001` não pode ser marcado como corrigido;
- tela bloqueada, reentrada, kill, force-stop, notificação e bateria agressiva
  continuam sem evidência física desta rodada;
- source maps/Sentry autenticado e assinatura release permanecem bloqueados;
- testes automatizados não reproduzem políticas reais de fabricantes Android.

## Validação física pendente

Após autorizar a chave ADB no aparelho:

1. executar `docs/22-teste-real-corrida-background.md`;
2. repetir em dev client e preview/release;
3. registrar modelo, Android, perfil, commit e modo de bateria;
4. anexar diagnóstico sanitizado;
5. somente então atualizar o status dos bugs.

## Próximo passo

A Fase D pode avançar com testes automatizados por ser uma extração compatível,
mas deve preservar rollback e não será considerada validada em produção até a
matriz física ser concluída.

## Nota posterior

Durante a Fase D, o mesmo aparelho autorizou ADB e recebeu um smoke test básico
de instalação/abertura do Dev Client. Não houve corrida ativa, bloqueio de tela,
kill, reentrada ou teste de rua; portanto, o resultado original e o gate físico
da Fase C permanecem pendentes.

## Commit sugerido

`docs(test): registrar gate automatizado da fase c`
