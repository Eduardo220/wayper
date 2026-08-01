# Visão do Produto

> **Status:** vigente<br>
> **Tipo:** fonte normativa sintética<br>
> **Escopo:** definição e proposta de valor do produto<br>
> **Última revisão:** 2026-08-01<br>
> **Fonte principal relacionada:** [`docs/product/direcao-estrategica-completa.md`](product/direcao-estrategica-completa.md)

## Nome

Wayper

## Descrição curta

A Wayper é uma plataforma mobile de exercício físico gamificada em que a
atividade acontece no mundo real e a principal experiência de descoberta acontece
depois dela.

> A Wayper transforma exercício físico em uma aventura contínua. Durante a
> atividade, o usuário apenas corre. Depois da atividade, descobre tudo o que
> conquistou.

Regra central: **a corrida é a ação; o pós-corrida é o jogo**.

## Problema

Aplicativos convencionais registram métricas, enquanto experiências gamificadas
frequentemente exigem atenção ao celular. A Wayper precisa oferecer motivação
física, estratégica e social sem comprometer segurança, confiança ou foco durante
o exercício.

## Solução

Registrar a atividade de forma local-first e resiliente e, depois do salvamento,
revelar desempenho, rota, territórios, progressão, competição e recompensas no
Relatório da Expedição.

## Público-alvo

- Pessoas fisicamente ativas que buscam motivação.
- Corredores iniciantes, casuais e avançados.
- Pessoas que gostam de gamificação.
- Usuários que exploram bairros, parques e rotas urbanas.
- Grupos de amigos que desejam competir de forma saudável.

## Proposta de valor

Exercício deixa de ser apenas dado registrado e se torna uma aventura contínua,
sem obrigar o usuário a olhar o celular durante a atividade.

## Pilares do produto

1. **Atividade confiável**: GPS, métricas, background, offline, recuperação,
   persistência e finalização resiliente.
2. **Descoberta pós-corrida**: Relatório da Expedição modular e reabrível.
3. **Conquista territorial**: consequência silenciosa do movimento real.
4. **Progressão e competição**: evolução física e estratégica.
5. **Exploração e comunidade**: desafios e experiências seguras.
6. **Negócio respeitoso**: assinatura por valor e parceiros fora da corrida.

## Métricas de sucesso

- Usuários ativos semanais.
- Corridas registradas por usuário.
- Retenção após 7, 14 e 30 dias.
- Total de zonas conquistadas.
- Participação em rankings.
- Abertura e reabertura da experiência pós-corrida, sem usar permanência na tela
  durante a atividade como objetivo.
- Taxa de conclusão de corridas iniciadas.
- Taxa de atividades salvas com sucesso.
- Processamentos derivados concluídos/recuperados.
- Retenção e conversão para Plus quando implementado.

## Premissas atuais

Estas premissas descrevem o estado conhecido e devem ser confirmadas no código,
nos testes e na configuração de `develop`; não alteram a direção normativa.

- O app é mobile e usa React Native com Expo.
- Firebase Auth segue como autenticacao.
- Firestore segue como remoto, cacheavel ou destino posterior de sync, mas os fluxos locais consolidados nao devem depender obrigatoriamente dele.
- Corrida ativa, historico, territorios, XP/conquistas, Home social, compartilhamento e diagnostico possuem base local-first documentada.
- O mapa utiliza MapLibre e OpenFreeMap.
- A branch `develop` concentra desenvolvimento ativo.
- A branch `main` representa a versão oficial.
- Home/Início e social; dashboard pessoal fica em Dashboard/Perfil/Resumo.
