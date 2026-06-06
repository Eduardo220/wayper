# Regras de Negócio

## Usuário

- Um usuário precisa estar autenticado para registrar corridas.
- Um usuário só pode editar o próprio perfil.
- Estatísticas públicas devem respeitar privacidade definida pelo produto.

## Corrida

- Uma corrida precisa ter início e fim.
- Uma corrida precisa ter distância mínima para ser considerada válida.
- Uma corrida precisa ter duração mínima para evitar registros acidentais.
- Pontos GPS com baixa precisão devem ser filtrados ou marcados.
- Corridas com comportamento impossível devem ser invalidadas ou revisadas.

- Depois de finalizada e salva localmente, a corrida deve permanecer visivel no historico mesmo se o sync remoto estiver `PENDING_SYNC` ou `SYNC_FAILED`.
- Firestore e destino posterior de sincronizacao; falha remota nao pode apagar `localRunId`, rota, segmentos ou resumo territorial local.
- Retry de sync deve ser idempotente por `localRunId`/`remoteRunId` e nao pode duplicar corrida remota.

## Zona conquistada

Regras a definir oficialmente:

- Como uma rota vira zona.
- Qual o tamanho mínimo de zona.
- Se zonas podem se sobrepor.
- Se um usuário pode conquistar território de outro.
- Se existe expiração ou disputa por tempo.
- Se zonas antigas podem ser atualizadas.

## Ranking

- Ranking pode considerar área conquistada, quantidade de zonas e distância.
- Ranking deve ter período: global, semanal e mensal.
- Usuário inválido ou banido não deve aparecer.
- Corridas inválidas não devem pontuar.
- Atualização de ranking deve ser consistente para evitar manipulação.

## Antifraude

Sinais suspeitos:

- Velocidade incompatível com corrida humana.
- Saltos de GPS muito grandes.
- Rota com poucos pontos e distância alta.
- Mudanças bruscas de localização.
- Corridas repetidas artificialmente.

## Grupos e amigos

A definir:

- Quem pode convidar.
- Quem pode ver estatísticas.
- Como ranking de grupo é calculado.
- Se grupos são públicos ou privados.

## Privacidade

- Não expor email publicamente.
- Não expor localização em tempo real para outros usuários sem regra clara.
- Histórico de rotas pode revelar casa/trabalho; tratar com cuidado.
- Permitir ocultar dados sensíveis deve ser considerado.
