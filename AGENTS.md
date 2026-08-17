# Wayper mobile

Entrada operacional canônica do app. Regras em subdiretórios apenas especializam
o próprio escopo.

## Fontes

- App gamificado de exercício em Expo/React Native. `develop` é ativa; `main`,
  referência estável. Prioridade: estabilidade da corrida.
- Leia este arquivo e `docs/00-fontes-do-projeto.md`; use a matriz por domínio.
  Não carregue `docs/` inteiro.
- Estado atual vem de código, testes, manifests, configuração e comportamento da
  branch de trabalho. Direção vem da estratégia, decisões e ADRs quando o domínio
  ou dúvida de produto/arquitetura exigir.
- README é visão rápida; roadmap, backlog, hipótese e ideia não autorizam código.
  Conflito entre decisões aprovadas exige revisão humana.

## Antes de alterar

- Confirme branch e `git status --short`; preserve WIP.
- Use Graphify para localização estrutural ampla quando útil, mas confirme no
  source, callers e testes atuais. Procure implementação semelhante e bugs.
- Defina escopo, validação e rollback. Consolide o caminho existente; não crie
  service, hook, repository, store, contexto ou componente paralelo.

## Invariantes da corrida

- **A corrida é a ação; o pós-corrida é o jogo.**
- Corrida ativa prioriza estabilidade; o usuário deve correr sem olhar o celular.
- Tracking suporta offline, background e tela apagada dentro dos limites reais.
  UI montada nunca é estado canônico.
- Firestore não é necessário para iniciar, acompanhar, finalizar, salvar ou
  recuperar atividade.
- Save mínimo local precede derivados. Territórios, XP, ranking, recompensas,
  replay, exportação, compartilhamento e sync remoto não bloqueiam o save.
- Nada pesado entra no caminho crítico do GPS; lógica crítica independe de tela.

## Progressive disclosure

- Antes de aprofundar, classifique tarefa/flags e use
  `docs/ai/context-routing.md`; carregue o mínimo e escale por risco.
- Skill/especialista só por gatilho/risco; nativos cobrem o genérico.
- Multi-agent é opt-in; prefira leitura paralela. Escrita paralela exige escopo
  disjunto conhecido. Protocolo: `docs/ai/orchestration.md`.
- Workflow: `docs/14-instrucoes-para-ia.md`. Arquitetura do Harness:
  `docs/ai/harness-v1.md`.
- Graphs, maps e caches nunca são verdade. RTK é ferramenta global opcional.

## Implementação e entrega

- Aplique Ponytail FULL: menor código correto, preservando validação, segurança,
  compatibilidade, acessibilidade, erros e proteção de dados.
- Não amplie escopo nem remova consumidores sem evidência. Atualize testes e a
  documentação dona da decisão.
- Trabalhe em fases verificáveis e reversíveis. Commit só quando autorizado;
  nunca alegue validação não executada.
- Divergência separa estado de direção e registra evidência, risco, migração e
  rollback. A entrega informa mudanças, testes, riscos, commits e próximo passo.
