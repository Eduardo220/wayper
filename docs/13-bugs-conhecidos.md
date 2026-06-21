# Bugs Conhecidos e Riscos

Use este arquivo para registrar bugs, riscos e limitacoes conhecidas enquanto nao viram issue detalhada. Nao apague bug conhecido sem registrar motivo, evidencia e decisao.

## Convencao de status

- `BLOQUEADO`: depende de credencial, aparelho, ambiente externo ou decisao.
- `EM_VALIDAÇÃO`: correcao ou mitigacao existe, mas ainda precisa validacao.
- `PRECISA_TESTE_REAL`: exige aparelho fisico, build release/dev real, rede real ou cenario de rua.
- `CORRIGIDO`: correcao aplicada e registrada com evidencia.
- `ADIADO`: reconhecido, mas fora da rodada atual.
- `LEGADO`: comportamento antigo conhecido que nao deve ser usado como base nova.

## Modelo para registrar um bug

```md
### BUG-YYYYMMDD-001 - Titulo curto

- ID: BUG-YYYYMMDD-001
- Titulo:
- Status: BLOQUEADO | EM_VALIDAÇÃO | PRECISA_TESTE_REAL | CORRIGIDO | ADIADO | LEGADO
- Severidade: critica | alta | media | baixa
- Area:
- Descricao:
- Como reproduzir:
  1.
  2.
  3.
- Evidencia:
- Causa provavel:
- Arquivos relacionados:
- Correcao aplicada:
- Teste necessario:
- Data: YYYY-MM-DD
- Decisao/observacao:
```

## Bugs ativos

Nenhum bug funcional especifico registrado nesta rodada. Os riscos abaixo permanecem ativos e devem virar bugs formais quando houver reproducao, evidencia ou impacto direto em usuario.

## Bugs em investigacao

Nenhum bug em investigacao registrado no momento.

## Bugs corrigidos

Nenhum bug corrigido registrado neste arquivo no momento.

## Bugs que exigem teste real

| ID | Titulo | Status | Severidade | Area | Evidencia atual | Teste necessario | Data |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BUG-20260620-001 | Background/tela bloqueada sem validacao fisica completa | PRECISA_TESTE_REAL | alta | Corrida ativa, GPS, Android | Risco conhecido da rodada local-first; emulador nao fecha o cenario real. | Executar `docs/22-teste-real-corrida-background.md` e `docs/wayper/15-checklist-validacao-corrida-ativa.md` em aparelho fisico dev e release. | 2026-06-20 |
| BUG-20260620-002 | Economia agressiva de bateria Android pode matar processo | PRECISA_TESTE_REAL | alta | Android, background, notificacao | Risco conhecido em fabricantes reais mesmo com foreground service. | Testar fabricantes reais com economia de bateria ligada/desligada e registrar resultado. | 2026-06-20 |
| BUG-20260620-003 | Source maps/Sentry sem validacao autenticada final | BLOQUEADO | media | Observabilidade, release | Falta evidencia de upload autenticado e simbolicacao real no painel. | Validar com credenciais reais e registrar evidencia sem expor tokens. | 2026-06-20 |
| BUG-20260620-004 | APK prod assinado com debug em validacao local antiga | BLOQUEADO | alta | Android release | Artefato debug-signed nao e publicavel. | Configurar assinatura release real e validar instalacao/publicabilidade. | 2026-06-20 |

## Riscos atuais da rodada local-first

| Risco | Status | Impacto | Proximo passo |
| --- | --- | --- | --- |
| Feed/Friends/Groups Firestore-first | BLOQUEADO | Social/grupos podem falhar offline enquanto Home principal ja e local-first. | Criar repositories/fallbacks incrementais antes de novas features sociais, com aprovacao de escopo. |
| Stories sem upload remoto | ADIADO | Story local permanece `PENDING_SYNC`. | Definir contrato remoto e fila de upload antes de implementar sync. |
| XP/conquistas sem sync remoto | ADIADO | Progresso e local por enquanto. | Definir contrato remoto idempotente. |
| Sync territorial remoto incompleto | ADIADO | Territorio local nao vira social/remoto completo. | Definir fila/contrato separados do sync de runs. |
| AsyncStorage com rotas/historicos longos | EM_VALIDAÇÃO | Parse/carregamento pode pesar. | Medir volume real antes de decidir SQLite. |
| Servicos legados presentes | LEGADO | Reativacao acidental pode duplicar arquitetura. | Manter docs/IA e testes bloqueando uso como fonte nova. |
| `console.*` legado fora de fluxos criticos | ADIADO | Pode poluir logs ou Sentry se reconfigurado. | Migrar gradualmente para `logger.js`. |

## Como registrar um bug

1. Use ID previsivel `BUG-YYYYMMDD-001`, incrementando o sufixo no mesmo dia.
2. Descreva o comportamento observado, nao uma hipotese solta.
3. Inclua evidencia: tela, log, export de diagnostico, comando, commit, arquivo ou relato de teste.
4. Separe causa provavel de causa confirmada.
5. Informe arquivos relacionados quando souber, mas nao invente arquivo.
6. Se corrigiu, registre a correcao aplicada e mova/atualize para `CORRIGIDO`.
7. Se ainda exige aparelho fisico, rede real, credencial ou build release, mantenha `PRECISA_TESTE_REAL` ou `BLOQUEADO`.
8. Nao apague bug antigo: registre decisao, data e motivo.
