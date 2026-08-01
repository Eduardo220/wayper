# Exemplos de Comandos para IA

> **Status:** vigente como exemplos<br>
> **Tipo:** referência operacional auxiliar<br>
> **Escopo:** modelos de solicitação e registro<br>
> **Última revisão:** 2026-08-01<br>
> **Fonte principal relacionada:** [`docs/14-instrucoes-para-ia.md`](14-instrucoes-para-ia.md)

Use estes exemplos no Codex quando quiser transformar uma mensagem em entrada formal da Wayper.

Estes exemplos não são instruções canônicas. Antes de qualquer lista “Quais
documentos deve ler”, carregue o núcleo permanente definido em `AGENTS.md` e use
a lista do exemplo somente como leitura adicional. Em divergência, prevalecem
`docs/00-fontes-do-projeto.md` e
`docs/product/direcao-estrategica-completa.md` dentro das respectivas
finalidades.

## 1. Ideia Wayper

```txt
Ideia Wayper:
Adicionar desafios semanais por bairro.
```

### O que a IA deve fazer

Analisar a ideia contra visão, MVP, roadmap e backlog. Classificar como alinhada com a visão, mas provavelmente fora do MVP atual.

### Quais documentos deve ler

- [[00-fontes-do-projeto]]
- [[01-visao-do-produto]]
- [[02-roadmap]]
- [[03-backlog]]
- [[10-regras-de-negocio]]
- [[02-mvp]]

### Onde deve registrar

[[16-ideias-de-melhoria]]

### Pode implementar direto?

Não. Precisa de análise, registro e aprovação humana.

## 2. Melhoria Wayper

```txt
Melhoria Wayper:
Ajustar a linha da corrida para ficar mais suave, sem tremido e sem cortar caminho.
```

### O que a IA deve fazer

Avaliar impacto em GPS, rota visual, cálculo de distância, território e mapa. Separar suavização visual de validação de pontos.

### Quais documentos deve ler

- [[03-backlog]]
- [[04-arquitetura]]
- [[10-regras-de-negocio]]
- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[03-mecanica-territorios]]

### Onde deve registrar

[[17-propostas-pendentes]], se houver solução concreta. [[16-ideias-de-melhoria]], se ainda for exploratória.

### Pode implementar direto?

Não. Precisa de aprovação humana, porque pode afetar GPS, mapa e território.

## 3. Problema Wayper

```txt
Problema Wayper:
O app está pedindo localização várias vezes e incomodando o usuário.
```

### O que a IA deve fazer

Classificar como bug/problema ou melhoria de UX. Investigar fluxo de permissão somente depois de consultar regras e registrar impacto.

### Quais documentos deve ler

- [[03-backlog]]
- [[06-fluxos-de-usuario]]
- [[10-regras-de-negocio]]
- [[05-gps-e-validacao]]
- [[13-bugs-conhecidos]]

### Onde deve registrar

[[13-bugs-conhecidos]]

### Pode implementar direto?

Só com aprovação humana, mesmo sendo problema, porque altera permissão e UX.

## 4. Feature Wayper

```txt
Feature Wayper:
Adicionar replay da corrida com velocidade de 1x até 5x.
```

### O que a IA deve fazer

Avaliar se a feature é MVP ou futura, estimar impacto em histórico, mapa, performance e armazenamento de rota.

### Quais documentos deve ler

- [[01-visao-do-produto]]
- [[02-roadmap]]
- [[03-backlog]]
- [[04-arquitetura]]
- [[08-firebase-firestore]]
- [[15-workflow-obsidian-ia]]

### Onde deve registrar

[[16-ideias-de-melhoria]] ou [[17-propostas-pendentes]]

### Pode implementar direto?

Não. Feature nova precisa de aprovação humana explícita.

## 5. Revisão Wayper

```txt
Revisão Wayper:
Revise as mudanças não commitadas e veja se estão alinhadas com a documentação.
```

### O que a IA deve fazer

Ler mudanças locais, comparar com documentação, apontar desalinhamentos, riscos e documentos que precisam ser atualizados.

### Quais documentos deve ler

- [[00-fontes-do-projeto]]
- [[14-instrucoes-para-ia]]
- [[15-workflow-obsidian-ia]]
- Documentos específicos afetados pela mudança.

### Onde deve registrar

[[19-revisoes-de-implementacao]]

### Pode implementar direto?

Não. Revisão gera diagnóstico e recomendações; correção depende de pedido ou aprovação.

## 6. Implementar Wayper

```txt
Implementar Wayper:
Implemente a proposta aprovada sobre melhoria da linha da corrida.
```

### O que a IA deve fazer

Confirmar que a proposta está aprovada, reler documentação afetada, implementar com escopo restrito e atualizar registros depois.

### Quais documentos deve ler

- [[17-propostas-pendentes]]
- [[18-changelog-produto]]
- [[19-revisoes-de-implementacao]]
- [[05-gps-e-validacao]]
- [[03-mecanica-territorios]]
- [[04-arquitetura]]

### Onde deve registrar

[[18-changelog-produto]] e [[19-revisoes-de-implementacao]]

### Pode implementar direto?

Sim, apenas se a proposta já estiver aprovada de forma explícita e a documentação estiver alinhada.

## 7. Sincronizar Wayper

```txt
Sincronizar Wayper:
Atualize a documentação com base nas mudanças recentes do código.
```

### O que a IA deve fazer

Ler mudanças recentes, identificar documentação afetada, registrar divergências e atualizar arquivos Markdown sem alterar código.

### Quais documentos deve ler

- [[00-fontes-do-projeto]]
- [[14-instrucoes-para-ia]]
- [[15-workflow-obsidian-ia]]
- [[18-changelog-produto]]
- [[19-revisoes-de-implementacao]]
- Documentos de domínio afetados.

### Onde deve registrar

[[18-changelog-produto]] e [[19-revisoes-de-implementacao]], além dos documentos específicos afetados.

### Pode implementar direto?

Pode atualizar documentação se o pedido for somente sincronização documental. Não pode alterar código sem novo pedido explícito.
