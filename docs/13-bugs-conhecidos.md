# Bugs Conhecidos e Riscos

Use este arquivo para registrar problemas conhecidos enquanto nao viram issue detalhada. Risco nao documentado vira surpresa de release, e surpresa de release raramente e charmosa.

## Template

```md
## Titulo do bug

**Status:** aberto | em analise | corrigido | nao reproduzido
**Prioridade:** alta | media | baixa
**Ambiente:** emulador | celular fisico | producao | dev
**Branch/versao:**
**Descricao:**
**Passos para reproduzir:**  
1.  
2.  
3.  

**Resultado esperado:**
**Resultado atual:**
**Observacoes:**
```

## Riscos atuais da rodada local-first

| Risco                                                   | Status    | Impacto                                                                      | Proximo passo                                                              |
| ------------------------------------------------------- | --------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Background/tela bloqueada sem validacao fisica completa | Aberto    | Pode perder pontos em aparelhos reais.                                       | Executar `docs/22-teste-real-corrida-background.md` em dev e release.      |
| Economia agressiva de bateria Android                   | Aberto    | Sistema pode matar processo mesmo com foreground service.                    | Testar fabricantes reais e orientar usuario quando necessario.             |
| Feed/Friends/Groups Firestore-first                     | Aberto    | Social/grupos podem falhar offline enquanto Home principal ja e local-first. | Criar repositories/fallbacks incrementais antes de novas features sociais. |
| Stories sem upload remoto                               | Aberto    | Story local permanece `PENDING_SYNC`.                                        | Definir contrato remoto e fila de upload.                                  |
| XP/conquistas sem sync remoto                           | Aberto    | Progresso e local por enquanto.                                              | Definir contrato remoto idempotente.                                       |
| Sync territorial remoto incompleto                      | Aberto    | Territorio local nao vira social/remoto completo.                            | Definir fila/contrato separados do sync de runs.                           |
| AsyncStorage com rotas/historicos longos                | A medir   | Parse/carregamento pode pesar.                                               | Medir volume real antes de SQLite.                                         |
| Servicos legados presentes                              | Monitorar | Reativacao acidental pode duplicar arquitetura.                              | Manter docs/IA e testes bloqueando uso como fonte nova.                    |
| `console.*` legado fora de fluxos criticos              | Monitorar | Pode poluir logs ou Sentry se reconfigurado.                                 | Migrar gradualmente para `logger.js`.                                      |
| Source maps/Sentry sem validacao autenticada final      | Aberto    | Stack release pode nao simbolicar corretamente.                              | Validar upload com credenciais e painel.                                   |
| APK prod assinado com debug em validacao local antiga   | Aberto    | Nao e artefato publicavel.                                                   | Configurar assinatura release real.                                        |

## Bugs atuais

Nenhum bug funcional especifico registrado aqui nesta rodada. Os itens acima sao riscos/pendencias conhecidas e devem virar issues quando entrarem em execucao.
