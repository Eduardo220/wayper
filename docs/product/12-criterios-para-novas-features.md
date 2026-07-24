# Critérios para novas features

Use este checklist antes de planejar ou implementar.

## Valor e momento

- [ ] o problema e o público estão definidos;
- [ ] a feature pertence à atividade, pós-corrida, progressão ou ecossistema;
- [ ] se exigir atenção, está fora da corrida;
- [ ] melhora valor real, não apenas impressão ou fricção artificial.

## Segurança e resiliência

- [ ] funciona sem Firestore no caminho da atividade;
- [ ] funciona offline ou possui fallback honesto;
- [ ] não adiciona trabalho pesado ao GPS;
- [ ] não depende de componente montado para estado crítico;
- [ ] não bloqueia salvamento mínimo;
- [ ] é idempotente, retomável e observável quando derivada;
- [ ] tem rollback e migração compatível.

## Arquitetura

- [ ] implementação semelhante foi procurada;
- [ ] não duplica serviço, hook, repository, store, contexto ou componente;
- [ ] regra está fora de UI;
- [ ] fornecedor externo está atrás de contrato;
- [ ] entitlement/flag/política central é usado quando aplicável;
- [ ] dados e eventos evitam informação sensível desnecessária.

## Produto e negócio

- [ ] status da ideia autoriza o nível de implementação;
- [ ] Free permanece respeitosa;
- [ ] parceiro ou anúncio não interrompe a atividade;
- [ ] pagamento não afeta tracking;
- [ ] recompensa tem elegibilidade, idempotência e auditoria.

## Entrega

- [ ] documentação e ADR correspondentes foram atualizados;
- [ ] testes automatizados proporcionais ao risco foram executados;
- [ ] validação física foi registrada quando realmente executada;
- [ ] riscos restantes e métricas foram documentados;
- [ ] commit é pequeno, verificável e reversível.

Falhar em um item crítico de segurança, salvamento ou status bloqueia a feature até
redesenho ou decisão explícita.
