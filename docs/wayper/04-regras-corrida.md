# Regras de caminhada e corrida

## Tipos de atividade

O MVP deve aceitar dois tipos de atividade:

- Caminhada.
- Corrida.

Os dois tipos usam GPS real, rota, distância, duração, XP e resumo. Diferenças finas de validação podem existir no futuro, mas o MVP deve manter a regra simples.

## Início da atividade

Antes de iniciar uma atividade, o app deve verificar:

- Usuário autenticado.
- Permissão de localização concedida.
- GPS disponível.
- Precisão inicial aceitável.
- Nenhuma outra atividade ativa.

Ao iniciar:

- Criar um estado local de atividade ativa.
- Registrar horário de início.
- Registrar tipo da atividade.
- Iniciar coleta de localização.
- Mostrar tela de atividade ativa.

## Atividade em andamento

Durante a atividade, o app deve acompanhar:

- Duração.
- Distância estimada.
- Pontos GPS válidos.
- Precisão dos pontos.
- Estado de pausa.
- Possível perda de sinal.

O app deve deixar claro quando o GPS estiver ruim ou quando parte da rota não estiver sendo considerada confiável.

## Pausa

O usuário pode pausar a atividade.

Durante a pausa:

- O tempo pausado não deve contar como tempo ativo.
- A distância não deve crescer.
- Pontos GPS coletados durante pausa não devem gerar rota válida.
- O app pode continuar monitorando localização de forma reduzida para melhorar retomada.

Pausas devem ser registradas para auditoria e resumo.

## Retomada

Ao retomar:

- Registrar horário de retomada.
- Voltar a contar tempo ativo.
- Retomar coleta de pontos válidos.
- Evitar conectar diretamente o último ponto antes da pausa ao primeiro ponto após a pausa se houver deslocamento grande.

Se o usuário se deslocou durante a pausa, o app deve tratar o trecho como lacuna, não como rota conquistada.

## Encerramento

Ao encerrar:

- Parar coleta de localização.
- Registrar horário de término.
- Calcular duração ativa.
- Calcular distância válida.
- Processar rota.
- Calcular XP.
- Calcular conquista territorial inicial.
- Persistir atividade e resumo no Firestore.
- Mostrar tela de resumo.

Atividades muito curtas podem ser salvas como rascunho, descartadas ou marcadas como inválidas. Essa regra ainda precisa ser decidida em [[10-decisoes-do-projeto]].

## Cancelamento

O usuário pode cancelar uma atividade em andamento.

Regra sugerida:

- Cancelamento não gera XP.
- Cancelamento não gera território.
- O app pode perguntar confirmação antes de descartar.
- O app não deve salvar rota completa se o usuário confirmar descarte, exceto logs técnicos mínimos se necessários e permitidos.

## Caminhada

Caminhada deve aceitar velocidades menores e pausas naturais. O app deve evitar invalidar caminhada apenas por ritmo lento.

Indicadores úteis:

- Distância.
- Duração.
- Ritmo médio.
- XP.
- Território conquistado.

## Corrida

Corrida deve aceitar velocidades maiores, mas ainda compatíveis com deslocamento humano.

Indicadores úteis:

- Distância.
- Duração.
- Pace.
- XP.
- Território conquistado.

Velocidades incompatíveis com corrida humana devem ser marcadas como suspeitas conforme [[05-gps-e-validacao]].

## Regras pendentes

- Distância mínima para salvar atividade.
- Duração mínima para gerar XP.
- Diferença de validação entre caminhada e corrida.
- Tratamento de atividade interrompida por fechamento do app.
- Retomada após perda prolongada de sinal.

