# Regras permanentes para agentes

Este arquivo vale para todo o repositório Wayper. Antes de alterar código ou
documentação, leia esta orientação e os documentos indicados para o domínio.

## Ordem oficial das fontes

1. código atual da branch `develop`;
2. código da branch `main`, somente como referência estável;
3. `README.md`;
4. documentação em `docs/`;
5. ADRs e decisões técnicas;
6. issues e pull requests;
7. planos locais;
8. conversas e anotações externas.

Em uma divergência, confirme o comportamento real, determine qual fonte está
desatualizada, atualize-a e registre a decisão. Não faça suposições silenciosas.

## Direção oficial

> A Wayper transforma exercício físico em uma aventura contínua. Durante a
> atividade, o usuário apenas corre. Depois da atividade, descobre tudo o que
> conquistou.

Regra central: **a corrida é a ação; o pós-corrida é o jogo**.

A Wayper é uma plataforma de exercício físico gamificada, territorial, social e
progressiva. Não é um agregador de cupons, mapa comercial, carteira digital,
marketplace genérico, cópia do Strava ou Pokémon GO, nem um produto centrado em
anúncios.

## Regras invioláveis da corrida

- tracking, checkpoints, recuperação e salvamento têm prioridade absoluta;
- iniciar, acompanhar, finalizar, salvar e recuperar não dependem do Firestore;
- a atividade deve funcionar localmente, offline, com tela apagada e em
  background;
- o caminho crítico do GPS não recebe processamento pesado, chamadas comerciais
  ou efeitos derivados;
- lógica crítica não depende de componente montado;
- a transação crítica de finalização/recovery até save mínimo, cleanup e
  liberação da UI usa dependências locais já carregadas; tarefas derivadas
  posteriores podem carregar adapters próprios sem bloquear a corrida;
- o total pausado é monotônico; retomar acumula a pausa antes de publicar
  `RUNNING`;
- a tela ativa é mínima: tempo, distância, pace, estado, GPS crítico, pausa,
  retomada, finalização e segurança;
- território é consequência silenciosa, apresentada principalmente depois;
- não há anúncios, ofertas, upgrade, parceiros ou recompensas durante atividade
  ativa/pausada, recuperação ou finalização;
- o salvamento mínimo acontece antes de território, XP, ranking, conquistas,
  recompensa, anúncio, replay, exportação, compartilhamento e sync remoto;
- falhas derivadas são retomáveis e nunca invalidam uma atividade salva.

## Arquitetura

- verifique serviços, hooks, repositories, stores, contextos, componentes e
  utilitários existentes antes de criar outro;
- se houver implementação parcial, consolide-a; não crie um caminho paralelo;
- preserve `activeRunTrackingService`, checkpoints, repositories e a fila
  pós-corrida como bases até uma migração explícita;
- mantenha domínio separado de Firebase, mapas, analytics, anúncios, pagamentos
  e outros fornecedores;
- entitlements, feature flags, política de anúncios, recompensas e pagamentos
  devem ter decisões centrais, não condicionais espalhadas por telas;
- gateway é infraestrutura substituível e nunca pertence ao domínio de tracking;
- recompensas são concedidas por domínio/aplicação, nunca por componente visual;
- qualquer remoção exige inventário de usos, impacto, substituição e rollback.

## Produto e negócio

- o Relatório da Expedição é a experiência pós-corrida principal;
- o relatório é modular, persistente, pulável, reabrível, offline-first e aceita
  resultados parciais honestos;
- Free preserva a experiência central;
- Plus entrega valor positivo; remoção de anúncios não pode ser seu único valor;
- Pro é hipótese até decisão específica;
- parceiros participam da experiência por desafios, eventos, temporadas ou
  recompensas; não interrompem o corredor;
- anúncios são uma fonte secundária, desacoplada e desligável;
- pagamentos, moedas, carteira, split e marketplace não são autorizados apenas
  por constarem como possibilidade futura.

## Status de ideias

Use somente: `aprovada`, `aprovada conceitualmente`, `planejada`, `em validação`,
`implementada`, `parcialmente implementada`, `descartada` ou `bloqueada`.

- “aprovada” orienta implementação;
- “aprovada conceitualmente” orienta arquitetura, não autoriza produção;
- “planejada” pode entrar no roadmap;
- “em validação” não autoriza código de produção;
- “descartada” exige nova decisão para retornar;
- “bloqueada” registra o motivo.

## Processo obrigatório

1. confirme branch e estado do Git;
2. leia README, documentação do domínio, ADRs, testes e bugs conhecidos;
3. procure implementação semelhante e caminhos legados;
4. trabalhe em fases pequenas, verificáveis e reversíveis;
5. execute testes proporcionais ao risco;
6. nunca declare teste, Android físico ou deploy que não ocorreu;
7. atualize documentação, ADR, changelog e revisão correspondente;
8. use commits separados por fase.

Ao fim de cada fase, registre diagnóstico, arquivos analisados/alterados,
justificativa, testes/resultados, riscos, validações físicas pendentes, próximos
passos e commit.

Comece por [docs/product/README.md](docs/product/README.md) e
[docs/00-fontes-do-projeto.md](docs/00-fontes-do-projeto.md).
