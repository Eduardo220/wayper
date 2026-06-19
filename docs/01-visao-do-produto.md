# Visão do Produto

## Nome

Wayper

## Descrição curta

O Wayper é um aplicativo mobile de corrida gamificado em que usuários registram rotas reais, conquistam zonas no mapa, competem por território e acompanham evolução física e estratégica.

## Problema

Muitos aplicativos de corrida focam apenas em tempo, distância, ritmo e histórico. Isso pode funcionar para atletas disciplinados, mas deixa a experiência repetitiva para usuários casuais ou competitivos que precisam de motivação visual, social e progressiva.

## Solução

Transformar corridas reais em uma disputa territorial no mapa da cidade. Cada trajeto pode expandir áreas conquistadas, alimentar rankings, desbloquear conquistas e incentivar exploração urbana.

## Público-alvo

- Corredores iniciantes que precisam de motivação.
- Corredores casuais que gostam de competição.
- Pessoas que gostam de gamificação.
- Usuários que exploram bairros, parques e rotas urbanas.
- Grupos de amigos que desejam competir de forma saudável.

## Proposta de valor

Correr deixa de ser apenas exercício registrado e passa a ser uma experiência de conquista, progressão e disputa estratégica.

## Pilares do produto

1. **Corrida real**: rastreamento por GPS e métricas úteis.
2. **Conquista territorial**: zonas no mapa associadas às rotas.
3. **Competição saudável**: ranking, progresso e disputa.
4. **Exploração urbana**: incentivo a conhecer novas áreas.
5. **Gamificação**: metas, conquistas, evolução e feedback visual.

## Métricas de sucesso

- Usuários ativos semanais.
- Corridas registradas por usuário.
- Retenção após 7, 14 e 30 dias.
- Total de zonas conquistadas.
- Participação em rankings.
- Tempo médio por sessão.
- Taxa de conclusão de corridas iniciadas.

## Premissas atuais

- O app é mobile e usa React Native com Expo.
- Firebase Auth segue como autenticacao.
- Firestore segue como remoto, cacheavel ou destino posterior de sync, mas os fluxos locais consolidados nao devem depender obrigatoriamente dele.
- Corrida ativa, historico, territorios, XP/conquistas, Home social, compartilhamento e diagnostico possuem base local-first documentada.
- O mapa utiliza MapLibre e OpenFreeMap.
- A branch `develop` concentra desenvolvimento ativo.
- A branch `main` representa a versão oficial.
- Home/Início e social; dashboard pessoal fica em Dashboard/Perfil/Resumo.
