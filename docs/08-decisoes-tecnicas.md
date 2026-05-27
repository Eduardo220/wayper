# Decisões Técnicas

Este arquivo registra decisões relevantes do projeto. Decisão não registrada vira arqueologia depois, e ninguém merece escavar commit velho.

## Como registrar decisão

Cada decisão deve conter:

- Título.
- Data.
- Status.
- Contexto.
- Decisão.
- Motivo.
- Alternativas consideradas.
- Impacto.
- Documentos relacionados.

Status oficiais:

- Proposta.
- Aprovada.
- Rejeitada.
- Substituída.

Observação: decisões antigas com status `aceito` equivalem a `Aprovada`.

## DEC-006: Usar Obsidian/Markdown como cérebro do projeto Wayper

Data: 2026-05-27
Status: Aprovada

### Contexto

A Wayper precisa manter produto, regras de negócio, decisões, ideias, problemas, changelog e revisões acessíveis para humano, Codex, Claude e outros assistentes.

### Decisão

Usar documentação em Markdown compatível com Obsidian como cérebro vivo do projeto Wayper, com `AGENTS.md`, `CLAUDE.md`, [[14-instrucoes-para-ia]] e [[15-workflow-obsidian-ia]] orientando o workflow de IA.

### Motivo

A documentação em Markdown permite que humano, Codex, Claude e GPT compartilhem o mesmo contexto do produto, reduzindo perda de informação e evitando implementação desalinhada.

### Alternativas consideradas

- Manter apenas conversas soltas com IA.
- Usar apenas issues externas.
- Depender apenas de comentários no código.

### Impacto

- Produto: melhora alinhamento antes de novas features.
- MVP: protege o foco em corrida, GPS, histórico, zonas e Firestore.
- GPS: exige análise documental antes de mexer em rastreamento.
- Mapa: exige análise documental antes de mexer em rotas e zonas.
- Firestore: reforça registro antes de novas coleções ou campos críticos.
- Performance: obriga avaliação antes de mudanças em mapa, GPS e dados.
- UX: registra problemas e decisões antes de alterar fluxos.
- Arquitetura: reduz decisões implícitas.

### Documentos relacionados

- [[00-fontes-do-projeto]]
- [[14-instrucoes-para-ia]]
- [[15-workflow-obsidian-ia]]
- [[16-ideias-de-melhoria]]
- [[17-propostas-pendentes]]

## ADR-001: Usar React Native com Expo

**Status:** aceito
**Contexto:** o Wayper é um app mobile com necessidade de GPS, mapa, câmera/arquivos em algumas features e build Android.
**Decisão:** usar React Native com Expo e Expo Dev Client.
**Consequências:**

- Desenvolvimento mobile mais rápido.
- Boa integração com módulos de localização.
- Build Android controlado por scripts.
- Algumas bibliotecas nativas exigem cuidado com prebuild/dev client.

## ADR-002: Usar Firebase como backend inicial

**Status:** aceito
**Contexto:** o app precisa de autenticação, persistência e sincronização.
**Decisão:** usar Firebase Auth e Firestore.
**Consequências:**

- Menos backend próprio no início.
- Regras de segurança do Firestore viram parte crítica do projeto.
- Algumas regras de negócio sensíveis talvez precisem migrar para Cloud Functions no futuro.

## ADR-003: Usar MapLibre/OpenFreeMap para mapas

**Status:** aceito
**Contexto:** o app depende muito de mapa e visualização de zonas.
**Decisão:** usar MapLibre React Native com OpenFreeMap.
**Consequências:**

- Mais controle sobre visualização do mapa.
- Menor dependência de provedores pagos tradicionais.
- Exige atenção a performance e renderização de polígonos/rotas.

## ADR-004: Usar Turf para cálculos geográficos

**Status:** aceito
**Contexto:** o app precisa calcular distância, área e manipular geometrias.
**Decisão:** usar Turf quando fizer sentido para cálculos geoespaciais.
**Consequências:**

- Facilita cálculo de área e operações com GeoJSON.
- Precisa validar performance em rotas grandes.
- Cálculos críticos devem ter testes.

## ADR-005: Separar `develop` e `main`

**Status:** aceito
**Contexto:** o projeto precisa diferenciar desenvolvimento ativo e versão oficial.
**Decisão:** `develop` será branch de desenvolvimento, `main` será branch oficial.
**Consequências:**

- Mudanças passam primeiro por `develop`.
- `main` deve receber apenas versões estáveis.
- Pull requests para `main` devem ser mais criteriosos.
