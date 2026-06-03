# Prompts para IA

## Como usar

Use estes prompts com Codex, Claude ou GPT quando precisar evoluir a Wayper. Antes de executar qualquer prompt, informe que `docs/wayper` é a fonte de verdade e peça para a IA ler [[00-index]].

## Revisar arquitetura

```text
Leia docs/wayper/00-index.md e docs/wayper/09-arquitetura-tecnica.md.
Revise a arquitetura atual da Wayper considerando React Native, Expo, Firebase, Firestore, GPS, mapas e mecânica de território.
Liste riscos, acoplamentos desnecessários e melhorias de baixo impacto.
Não altere código sem apontar exatamente quais arquivos seriam afetados.
Explique impactos em GPS, mapa, Firestore, performance e experiência do usuário.
```

## Implementar feature

```text
Leia docs/wayper/00-index.md, docs/wayper/02-mvp.md e qualquer documento relacionado à feature.
Implemente a feature seguindo o escopo do MVP.
Se a feature estiver fora do MVP, explique a justificativa antes de implementar e registre proposta na documentação.
Não crie coleção nova no Firestore sem atualizar docs/wayper/08-firebase-firestore.md e docs/wayper/10-decisoes-do-projeto.md.
Ao final, liste arquivos alterados e riscos restantes.
```

## Analisar bug

```text
Leia docs/wayper/00-index.md e identifique quais regras de produto ou engenharia se conectam ao bug.
Analise a causa provável sem alterar código primeiro.
Depois proponha a correção mais simples.
Se o bug envolver GPS, mapa, Firestore, performance ou experiência do usuário, explique o impacto em cada área.
Ao corrigir, mantenha a alteração no menor escopo possível.
```

## Melhorar documentação

```text
Leia docs/wayper/00-index.md.
Revise a documentação relacionada ao tema informado.
Melhore clareza, completude e rastreabilidade das decisões.
Não transforme propostas em decisões oficiais sem atualizar docs/wayper/10-decisoes-do-projeto.md.
Use links internos estilo Obsidian.
Mantenha tudo em português.
```

## Revisar Firestore

```text
Leia docs/wayper/08-firebase-firestore.md e docs/wayper/10-decisoes-do-projeto.md.
Revise a modelagem proposta para usuários, atividades, rotas, conquistas e rankings.
Avalie custo, consultas frequentes, risco de excesso de escrita, segurança e facilidade de migração.
Marque claramente o que é decisão, proposta e ponto pendente.
Não crie coleções novas sem registrar a decisão.
```

## Revisar mecânica de território

```text
Leia docs/wayper/03-mecanica-territorios.md, docs/wayper/05-gps-e-validacao.md e docs/wayper/08-firebase-firestore.md.
Revise a mecânica de conquista territorial para o MVP.
Compare alternativas como células, buffer de rota e zonas predefinidas.
Avalie impacto em GPS, renderização de mapa, Firestore, custo, anti-fraude e clareza para o usuário.
Recomende uma abordagem inicial simples e documente riscos.
```

## Planejar tela ou fluxo

```text
Leia docs/wayper/07-telas-e-fluxos.md e docs/wayper/02-mvp.md.
Planeje a tela ou fluxo solicitado para React Native com Expo.
Mantenha o foco no ciclo principal do MVP.
Descreva estados vazios, carregamento, erro, permissão de GPS e ações principais.
Não inclua features futuras como clans ou ranking global sem justificar.
```

## Criar proposta de decisão

```text
Leia docs/wayper/10-decisoes-do-projeto.md.
Crie uma nova proposta de decisão sobre o tema informado usando o template do documento.
Inclua impactos em GPS, mapa, Firestore, performance e experiência do usuário.
Não mova a proposta para decisões aprovadas sem confirmação explícita.
```

