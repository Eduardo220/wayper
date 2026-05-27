# Bugs Conhecidos

Use este arquivo para registrar problemas conhecidos enquanto não viram issue detalhada. Bugs e riscos que afetem produto, GPS, mapa, Firestore, performance ou UX devem ser analisados antes de qualquer implementação.

## Formato obrigatório

```md
## Título do bug

Status:
Prioridade:
Contexto:
Impacto:
Hipótese:
Solução sugerida:
Documentos relacionados:
```

## Status sugeridos

- Aberto
- Em análise
- Corrigido
- Não reproduzido
- Adiado

## GPS

Nenhum bug confirmado registrado ainda.

### Pendências de investigação

- Validar comportamento do GPS em corrida real.
- Validar comportamento do app em segundo plano.
- Validar precisão mínima aceitável para território e XP.

## Mapa

Nenhum bug confirmado registrado ainda.

### Pendências de investigação

- Validar performance de rotas, polígonos e zonas no mapa.
- Validar se a linha da corrida continua fiel à rota real após qualquer simplificação visual.

## Firestore

Nenhum bug confirmado registrado ainda.

### Pendências de investigação

- Validar segurança das regras do Firestore.
- Validar custo de escrita e leitura para rotas longas.
- Validar estratégia para salvar pontos GPS sem custo excessivo.

## Permissões

Nenhum bug confirmado registrado ainda.

### Pendências de investigação

- Validar fluxo de permissão de localização negada.
- Validar se o app evita pedir localização repetidamente de forma incômoda.

## Performance

Nenhum bug confirmado registrado ainda.

### Pendências de investigação

- Validar consumo de bateria durante atividade ativa.
- Validar performance do mapa com histórico e zonas.

## UX

Nenhum bug confirmado registrado ainda.

### Pendências de investigação

- Validar clareza de GPS fraco para o usuário.
- Validar mensagens de erro durante perda de sinal.
- Validar resumo pós-corrida com rota, distância, XP e território.

## Build

Nenhum bug confirmado registrado ainda.

### Pendências de investigação

- Validar scripts dev/prod em máquinas diferentes.
- Validar build Android quando houver mudança de dependência nativa.

## Compartilhamento

Nenhum bug confirmado registrado ainda.

### Pendências de investigação

- Compartilhamento social está fora do foco imediato e deve ser reavaliado depois do MVP central.

## Sincronização

Nenhum bug confirmado registrado ainda.

### Pendências de investigação

- Validar sincronização entre dados locais, Firestore e histórico.
- Validar recuperação de atividade em caso de app fechado ou conexão instável.
