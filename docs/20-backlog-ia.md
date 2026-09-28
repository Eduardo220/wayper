# Backlog da IA

Este arquivo guarda tarefas sugeridas pela IA. Tarefas daqui não entram automaticamente no backlog principal e não podem alterar prioridade do produto sem aprovação humana.

## Formato de tarefa

```md
### [Título da tarefa]

Status:
Prioridade:
Motivo:
Impacto no MVP:
Documentos relacionados:
Precisa de aprovação humana: Sim | Não
```

## Produto

Nenhuma tarefa registrada ainda.

## GPS

Nenhuma tarefa registrada ainda.

## Mapa

Nenhuma tarefa registrada ainda.

## Firestore

Nenhuma tarefa registrada ainda.

## Performance

Nenhuma tarefa registrada ainda.

## UX

Nenhuma tarefa registrada ainda.

## Segurança

Nenhuma tarefa registrada ainda.

## Antifraude

Nenhuma tarefa registrada ainda.

## Documentação

### Revisar sincronização entre `docs/wayper` e `/docs`

Status: Sugerida
Prioridade: Média
Motivo: `develop` é a primeira fonte do comportamento; `docs/product` registra a
direção e `docs/wayper` preserva detalhe/histórico. Revisões periódicas reduzem
divergência.
Impacto no MVP: Indireto, melhora alinhamento antes de mudanças em GPS, mapa, Firestore e regras.
Documentos relacionados: [[00-fontes-do-projeto]], [[00-index]], [[15-workflow-obsidian-ia]]
Precisa de aprovação humana: Não para revisão documental; sim para alterar decisões de produto.

### Auditar divergências sobre zonas, ranking e Firestore

Status: Sugerida
Prioridade: Alta
Motivo: [[15-corrida-por-zonas]] descreve detalhes de zonas, sincronização e ranking que precisam ser reconciliados com as decisões pendentes em [[02-mvp]], [[08-firebase-firestore]] e [[10-decisoes-do-projeto]].
Impacto no MVP: Alto, porque afeta território, ranking, custo do Firestore e clareza do escopo.
Documentos relacionados: [[15-corrida-por-zonas]], [[02-mvp]], [[03-mecanica-territorios]], [[08-firebase-firestore]], [[10-decisoes-do-projeto]]
Precisa de aprovação humana: Sim, caso a auditoria proponha mudar regra de produto ou arquitetura.

## Refatoração

Nenhuma tarefa registrada ainda.
