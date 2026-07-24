# Glossário

## Expedição

Representação da atividade salva e de seus resultados derivados. O processamento
pode completar território, progressão, ranking, desafios e recompensas de forma
parcial e retomável.

## Relatório da Expedição

Experiência pós-corrida modular, persistente e reabrível que apresenta métricas,
rota e resultados da Expedição sem bloquear o salvamento.

## Entitlement

Capability concedida por plano, promoção ou papel, resolvida centralmente e com
fallback offline. Não altera tracking ou acesso aos dados essenciais.

## Parceiro

Participante opcional da experiência por campanha, desafio, evento ou recompensa.
Não aborda o usuário durante a atividade.

## Território

Área do mapa conquistada pelo usuário a partir de uma atividade real com GPS válido. Pode ser representado por células, zonas, polígonos ou outra estratégia ainda pendente.

## Rota

Sequência de pontos GPS coletados durante uma caminhada ou corrida. A rota pode ter segmentos separados por pausa, perda de sinal ou pontos inválidos.

## Atividade

Registro de uma caminhada ou corrida iniciada pelo usuário. Uma atividade possui tipo, início, fim, duração, distância, rota, XP e possível conquista territorial.

## Conquista

Resultado obtido a partir de uma atividade válida. Pode representar território novo, marco de progresso, XP ou medalha futura.

## XP

Pontos de experiência usados para medir progresso do usuário. No MVP, XP deve ser calculado principalmente por distância válida e conclusão de atividade.

## Nível

Representação simples da evolução do usuário, derivada do XP total.

## Zona

Área delimitada do mapa. Pode ser uma célula, região ou área especial. Zonas temporárias e disputáveis ficam fora do MVP.

## Clan

Grupo de usuários que pode somar progresso e competir coletivamente no futuro. Clans ficam fora do MVP.

## Ranking

Lista ordenada de usuários ou grupos por uma métrica, como XP, distância ou território. Ranking competitivo completo fica fora do MVP.

## Ponto GPS

Uma leitura de localização com latitude, longitude, precisão, timestamp e possivelmente velocidade. Pontos GPS são a base da rota.

## Precisão

Estimativa de erro da localização. Quanto menor o valor em metros, mais confiável tende a ser o ponto GPS.

## Ponto inválido

Ponto GPS que não deve contar para distância, XP ou território por baixa precisão, salto estranho, velocidade impossível, pausa ou erro de timestamp.

## Segmento

Parte contínua da rota. Uma atividade pode ter vários segmentos quando há pausa, perda de sinal ou interrupção.

## Firestore

Banco de dados usado para persistir usuários, atividades, rotas, conquistas e dados agregados.

## MVP

Versão mínima do produto usada para validar o ciclo central da Wayper: atividade real com GPS, rota, XP, resumo e conquista territorial simples.

## Anti-cheat

Conjunto de validações para reduzir trapaças, como GPS falso, saltos impossíveis ou velocidade incompatível com caminhada e corrida.

