# Prompts para IA

> **Status:** vigente como biblioteca de exemplos<br>
> **Tipo:** referência operacional auxiliar<br>
> **Escopo:** prompts temáticos para tarefas do Wayper<br>
> **Última revisão:** 2026-08-01<br>
> **Fonte principal relacionada:** [`AGENTS.md`](../../AGENTS.md)

Este arquivo não define regras próprias para agentes. Os prompts abaixo só
acrescentam contexto temático ao núcleo permanente.

## Entrada canônica para qualquer prompt

Use uma referência curta, sem copiar outra versão das regras:

```txt
Siga AGENTS.md e o Context Gate de docs/14-instrucoes-para-ia.md.
Leia o nucleo permanente e use a matriz de docs/00-fontes-do-projeto.md para
selecionar as fontes adicionais deste dominio. Confronte a tarefa com
docs/product/direcao-estrategica-completa.md antes de alterar qualquer arquivo.
```

`docs/24-resumo-rodada-local-first.md` é um snapshot datado e só deve ser lido
quando a matriz ou o domínio da tarefa o exigir.

## Como usar

Use estes prompts com Codex, Claude ou GPT quando precisar evoluir a Wayper. Antes
de executar qualquer prompt, carregue `AGENTS.md`,
`docs/00-fontes-do-projeto.md`,
`docs/product/direcao-estrategica-completa.md` e `README.md`. As fontes citadas
em cada exemplo são adicionais. O código de `develop` é a primeira fonte do
comportamento implementado, não da direção estratégica.

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
Implemente a feature somente se estiver no escopo aprovado da tarefa.
Se estiver fora do escopo aprovado ou for hipótese, registre a proposta e aguarde decisão explícita; não implemente.
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
Não inclua features futuras como clans ou ranking global sem decisão aprovada.
```

## Criar proposta de decisão

```text
Leia docs/wayper/10-decisoes-do-projeto.md.
Crie uma nova proposta de decisão sobre o tema informado usando o template do documento.
Inclua impactos em GPS, mapa, Firestore, performance e experiência do usuário.
Não mova a proposta para decisões aprovadas sem confirmação explícita.
```
