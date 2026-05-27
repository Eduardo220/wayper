# XP, nível e ranking

## Objetivo

XP, nível e ranking devem aumentar motivação sem tornar o MVP complexo. A primeira versão precisa ser fácil de explicar, barata de calcular e resistente a erros básicos de GPS.

## XP no MVP

Regra inicial proposta:

- XP principal por distância válida.
- Bônus pequeno por território novo.
- Bônus pequeno por concluir atividade válida.
- Nenhum bônus por velocidade no MVP.

Essa regra evita incentivar comportamento perigoso ou fraude por velocidade.

## Fórmula inicial sugerida

Proposta simples:

- 10 XP por quilômetro válido.
- 5 XP por atividade válida concluída.
- 1 XP por unidade simples de território novo, se a mecânica territorial permitir.

Os valores são placeholders de balanceamento. Devem ser ajustados após testes reais.

## Atividade válida para XP

Uma atividade deve gerar XP somente se:

- Foi finalizada pelo usuário.
- Possui distância válida acima do mínimo definido.
- Possui duração compatível com caminhada ou corrida.
- Não foi marcada como claramente suspeita.

Atividades com problemas parciais podem gerar XP reduzido no futuro. Para o MVP, a regra deve ser binária sempre que possível.

## Níveis

O nível do usuário deve ser derivado do XP total.

Regra inicial sugerida:

- Nível 1: 0 XP.
- Nível 2: 100 XP.
- Nível 3: 250 XP.
- Nível 4: 500 XP.
- Nível 5: 900 XP.

Após o MVP, a curva pode ser ajustada. O importante é que o nível não dependa de cálculos ocultos difíceis de migrar.

## Ranking

Ranking completo fica fora do MVP, mas o app pode preparar dados para ranking futuro.

Ranking inicial, se existir, deve ser simples:

- XP total.
- Distância válida total.
- Quantidade de atividades concluídas.
- Território conquistado, se a métrica estiver estável.

Ranking não deve definir posse competitiva de território no MVP.

## Cuidados

- Não recompensar GPS ruim.
- Não recompensar atividade cancelada.
- Não criar fórmula difícil de explicar.
- Não depender de ranking para validar a proposta principal.
- Não criar competição forte antes de regras mínimas anti-fraude.

## Pontos pendentes

- Distância mínima para XP.
- Tratamento de atividades suspeitas.
- Curva final de nível.
- Métrica oficial de ranking.
- Se XP deve ser recalculável a partir das atividades salvas.

## Documentos relacionados

- [[02-mvp]]
- [[03-mecanica-territorios]]
- [[05-gps-e-validacao]]
- [[08-firebase-firestore]]

