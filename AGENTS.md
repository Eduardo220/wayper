# Regras permanentes para agentes

Este arquivo é a entrada canônica de instruções para todo o repositório Wayper.
Arquivos de agentes em subdiretórios podem apenas acrescentar regras do próprio
escopo; nunca podem contradizer este documento.

## Contexto do projeto

- Wayper é um aplicativo mobile de exercício físico gamificado, construído com
  React Native e Expo.
- `develop` é a branch de desenvolvimento ativo; `main` é a referência estável.
- A prioridade atual é a estabilidade da corrida: tracking, background,
  offline, recuperação, persistência e finalização segura.

## Núcleo obrigatório em toda tarefa

Leia, nesta ordem, antes de alterar código ou documentação:

1. `AGENTS.md`;
2. [`docs/00-fontes-do-projeto.md`](docs/00-fontes-do-projeto.md);
3. [`docs/product/direcao-estrategica-completa.md`](docs/product/direcao-estrategica-completa.md);
4. [`README.md`](README.md).

Depois, identifique o domínio da tarefa e use a matriz de leitura em
`docs/00-fontes-do-projeto.md`. Não carregue `docs/` inteiro sem necessidade.
O processo detalhado para agentes está em
[`docs/14-instrucoes-para-ia.md`](docs/14-instrucoes-para-ia.md).

## Dois tipos de verdade

- **Estado atual:** código e testes de `develop`, configuração e comportamento
  observável mostram o que existe hoje; `main` serve apenas como referência
  estável.
- **Direção e decisões:** a direção estratégica, decisões aprovadas e ADRs
  aceitas definem como o projeto deve evoluir e quais limites são permanentes.

O código não valida automaticamente uma decisão estratégica legada ou incorreta.
Roadmap e backlog ordenam trabalho; hipóteses não autorizam implementação.

## Checklist inicial obrigatório

Antes de alterar qualquer coisa:

- confirme a branch e execute `git status --short`;
- identifique e preserve alterações locais existentes;
- leia o núcleo obrigatório e as fontes específicas do domínio;
- localize a implementação atual, caminhos legados e trabalho semelhante;
- identifique testes existentes e bugs conhecidos relacionados;
- confronte estado atual com direção aprovada e registre divergências;
- defina o escopo e a fase autorizada, com validação e rollback;
- evite duplicar serviço, hook, repository, store, contexto, componente,
  utilitário, storage ou pipeline.

## Princípios permanentes

- **A corrida é a ação; o pós-corrida é o jogo.**
- Durante corrida ativa, estabilidade possui prioridade absoluta.
- O usuário deve poder correr sem olhar para o celular.
- O tracking deve funcionar offline, em background e com a tela apagada, dentro
  dos limites reais e documentados da plataforma.
- A interface não é a fonte canônica do estado da corrida.
- Firestore não pode ser obrigatório para iniciar, acompanhar, finalizar,
  salvar ou recuperar uma atividade.
- O save mínimo local ocorre antes de qualquer processamento derivado.
- Territórios, XP, ranking, recompensas, replay, exportação, compartilhamento e
  sync remoto não podem bloquear o salvamento.
- Não execute processamento pesado no caminho crítico do GPS.
- Não acople lógica crítica a componente montado.
- Pesquise e consolide o caminho existente antes de criar implementação nova.
- Não implemente hipótese como decisão aprovada.
- Não declare teste, lint, deploy ou validação física que não ocorreu.
- Toda alteração relevante atualiza documentação e testes correspondentes.
- Trabalhe em fases pequenas, verificáveis, reversíveis e com commits separados;
  não faça commit sem autorização da tarefa.

## Protocolo de divergência

Quando código e documentação divergirem:

1. registre a divergência sem escolher silenciosamente;
2. verifique o comportamento real no código, testes, configuração e, quando
   aplicável, em execução observável;
3. identifique a fonte que descreve o estado atual;
4. identifique a fonte que representa a direção ou decisão aprovada;
5. não transforme comportamento legado em regra estratégica;
6. corrija ou marque claramente a fonte desatualizada;
7. registre decisão relevante em ADR ou documento equivalente;
8. apresente risco, impacto, migração e rollback.

Se duas decisões estratégicas continuarem incompatíveis, registre o bloqueio e
solicite decisão humana. Não altere uma regra estratégica por inferência.

## Limite de escopo

Não aproveite uma tarefa pequena para reescrever o projeto, criar arquitetura
paralela, trocar fornecedor, alterar domínio não relacionado, remover
compatibilidade ou executar limpeza ampla não solicitada. Remoções exigem
inventário de usos, substituição, impacto, migração e rollback.

## Entrega por fase

Ao final de cada fase, registre:

- diagnóstico e fontes consultadas;
- arquivos analisados e alterados;
- justificativas e decisões;
- testes e validações realmente executados, com resultados;
- riscos e validações físicas pendentes;
- divergências e pendências;
- rollback e próximo passo;
- commit sugerido.
