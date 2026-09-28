# Direção estratégica completa da Wayper

> **Status:** aprovado<br>
> **Tipo:** fonte normativa<br>
> **Escopo:** produto, negócio, arquitetura, experiência da corrida e
> pós-corrida, estabilidade, dados, monetização, testes e evolução do projeto<br>
> **Autoridade:** fonte principal para direção e restrições permanentes; o estado
> implementado deve ser confirmado no código, nos testes e na configuração<br>
> **Público:** mantenedores, contribuidores, agentes de IA e responsáveis por
> produto, design, arquitetura, operação e negócio<br>
> **Última revisão:** 2026-08-01<br>
> **Documentos relacionados:** [`AGENTS.md`](../../AGENTS.md),
> [`docs/00-fontes-do-projeto.md`](../00-fontes-do-projeto.md),
> [`docs/product/README.md`](README.md),
> [`docs/04-arquitetura.md`](../04-arquitetura.md),
> [`docs/02-roadmap.md`](../02-roadmap.md),
> [`docs/03-backlog.md`](../03-backlog.md) e
> [`docs/architecture/adrs-direcao-oficial.md`](../architecture/adrs-direcao-oficial.md)

## Governança

Este documento representa a direção aprovada e as restrições que orientam novas
decisões. Agentes devem usá-lo para avaliar escopo, arquitetura, ordem de
evolução, riscos e compatibilidade estratégica antes de propor ou implementar
mudanças.

Ele não substitui a inspeção do código atual e não é um inventário do que já está
implementado. A presença de uma funcionalidade, fase ou integração neste texto
não prova que ela exista. Itens marcados como hipótese, em validação, planejados
ou conceituais não autorizam produção; fases futuras não devem preceder a
fundação confiável.

Em divergências, separe a evidência do estado atual da direção aprovada, registre
a lacuna e corrija a fonte desatualizada. Nenhum agente pode alterar
silenciosamente uma regra estratégica. Mudanças de direção exigem decisão humana
explícita, atualização deste documento e alinhamento de decisões, ADRs, roadmap,
backlog e fontes temáticas afetadas.

## Como usar este documento em novas tarefas

1. Leia o núcleo permanente definido em `AGENTS.md`.
2. Confirme o estado real no código, nos testes e na configuração.
3. Classifique a proposta como aprovada, planejada, em validação, hipótese ou
   bloqueada antes de considerar implementação.
4. Avalie a proposta contra os critérios estratégicos e as restrições deste
   documento.
5. Se houver conflito, registre-o e não implemente até existir decisão explícita.

## Natureza das seções preservadas

Este documento preserva, além das regras estratégicas, o blueprint que originou
sua consolidação. Princípios, decisões e restrições de produto/arquitetura são
normativos. Já verbos como “audite”, “crie”, “atualize”, “execute” ou “entregue”
em roteiros, matrizes, estrutura documental e fases descrevem critérios e
sequências de referência; não constituem uma tarefa automática para toda nova
execução.

O processo operacional vigente fica em `AGENTS.md` e
`docs/14-instrucoes-para-ia.md`, e o roteamento de fontes fica em
`docs/00-fontes-do-projeto.md`. Um agente só executa um bloco procedural deste
documento quando a tarefa o autorizar e o estado real justificar. Isso não reduz
a autoridade dos invariantes estratégicos contidos no mesmo bloco.

---

Você está trabalhando no projeto Wayper.

Esta tarefa tem como objetivo revisar, consolidar e aplicar a nova direção oficial de produto, negócio e arquitetura da Wayper.

Não trate esta solicitação como uma funcionalidade isolada.

A nova visão deve se tornar uma regra permanente do projeto e orientar:

* código;
* arquitetura;
* documentação;
* design;
* experiência do usuário;
* modelo de negócio;
* monetização;
* parcerias;
* progressão;
* gamificação;
* decisões futuras;
* atuação de agentes de IA;
* implementação de novas funcionalidades.

O objetivo é fazer a Wayper deixar de ser percebida apenas como um aplicativo de corrida com territórios e passar a operar como uma plataforma de exercício físico gamificada, em que a atividade acontece no mundo real e a principal experiência de descoberta acontece depois dela.

---

# 1. INSTRUÇÕES OBRIGATÓRIAS DO PROJETO

Antes de implementar qualquer coisa:

1. Leia `AGENTS.md` e o núcleo permanente definido nele.
2. Confirme a branch ativa, o estado do Git e alterações locais existentes.
3. Analise código, testes e configuração atuais da branch `develop`.
4. Use `main` apenas como referência estável.
5. Identifique o domínio e use a matriz de `docs/00-fontes-do-projeto.md` para
   ler somente a documentação relevante; não carregue `docs/` inteiro sem
   necessidade.
6. Verifique se já existe implementação semelhante ou caminho legado.
7. Trate `README.md` como resumo de entrada, não substituto da evidência de
   estado nem desta direção normativa.
8. Não duplique serviços, hooks, repositories, stores, contextos, componentes ou lógica existente.
9. Se algo existir parcialmente, refatore, consolide e complete em vez de criar implementação paralela.
10. Preserve o padrão visual, arquitetura, nomenclatura e estrutura atual quando estiverem corretos.
11. Não remova funcionalidades existentes sem:

    * identificar todos os usos;
    * analisar impacto;
    * justificar;
    * definir substituição;
    * garantir rollback.
12. Não torne Firestore obrigatório para iniciar, acompanhar, finalizar, salvar ou recuperar uma corrida.
13. O app deve continuar funcionando em modo local e offline.
14. Não execute processamento pesado no caminho crítico do GPS.
15. Não acople lógica crítica de corrida a componentes montados.
16. Não segure a finalização esperando:

    * território;
    * XP;
    * ranking;
    * recompensa;
    * anúncio;
    * replay;
    * exportação;
    * compartilhamento;
    * sincronização remota.
17. Toda decisão técnica importante deve atualizar a documentação correspondente.
18. Não declare testes que não foram executados.
19. Não declare validação em Android físico sem teste real.
20. Trabalhe em fases pequenas, verificáveis, reversíveis e com commits separados.
21. Ao final de cada fase, entregue:

    * diagnóstico;
    * arquivos analisados;
    * arquivos alterados;
    * justificativas;
    * testes executados;
    * resultados;
    * riscos restantes;
    * validações físicas pendentes;
    * próximos passos;
    * commit sugerido.

---

# 2. SISTEMA OFICIAL DAS FONTES

Não existe uma hierarquia linear única para todas as perguntas. Use o tipo de
verdade adequado.

## 2.1 Estado atual

Para descobrir o que existe e como funciona hoje, consulte:

1. código atual da branch `develop`;
2. testes atuais;
3. configuração atual;
4. comportamento observável com evidência;
5. branch `main`, somente como referência estável.

O código é fonte de verdade do comportamento existente. Código legado ou
incorreto não se torna automaticamente uma decisão estratégica válida.

## 2.2 Direção e decisões

Para decidir como o projeto deve evoluir, consulte:

1. este documento;
2. decisões aprovadas;
3. ADRs aceitas;
4. princípios e regras de negócio vigentes;
5. roadmap aprovado;
6. backlog priorizado.

README e documentação temática resumem, explicam e conectam essas fontes.
Issues, pull requests, planos locais, conversas e anotações externas têm
autoridade apenas dentro do próprio escopo e nunca promovem hipótese a decisão.

Quando houver divergência:

1. identifique e registre a divergência;
2. confirme o comportamento real;
3. separe a fonte de estado atual da fonte de direção aprovada;
4. não faça suposições silenciosas nem modifique regra estratégica por inferência;
5. corrija ou marque a fonte desatualizada;
6. registre decisão relevante e seus impactos;
7. peça decisão humana se duas decisões estratégicas permanecerem incompatíveis.

---

# 3. NOVA VISÃO OFICIAL DA WAYPER

A visão oficial passa a ser:

> A Wayper transforma exercício físico em uma aventura contínua. Durante a atividade, o usuário apenas corre. Depois da atividade, descobre tudo o que conquistou.

A regra principal é:

> A corrida é a ação. O pós-corrida é o jogo.

A Wayper deve ser compreendida como:

* plataforma de atividade física gamificada;
* jogo territorial baseado em movimento real;
* experiência de competição e exploração urbana;
* sistema de progressão física e estratégica;
* plataforma futura de desafios;
* plataforma futura de comunidades;
* ecossistema futuro de parceiros e patrocinadores;
* produto com modelo de assinatura;
* infraestrutura futura para eventos, recompensas e pagamentos.

A Wayper não deve se tornar:

* um aplicativo cheio de anúncios;
* um agregador de cupons;
* uma cópia do Strava;
* uma cópia de Pokémon GO;
* um mapa comercial;
* uma carteira digital;
* um marketplace genérico;
* um aplicativo que obriga o usuário a olhar o celular enquanto corre;
* uma plataforma de anúncios disfarçada de corrida.

---

# 4. PRINCÍPIOS CENTRAIS DO PRODUTO

## 4.1 Durante a corrida, a Wayper deve desaparecer

Durante uma corrida ativa, o papel da Wayper é:

* registrar;
* proteger;
* preservar;
* calcular métricas essenciais;
* funcionar com tela apagada;
* funcionar em background;
* funcionar offline;
* recuperar a atividade após falhas;
* permitir pausa;
* permitir retomada;
* permitir finalização segura.

Durante a corrida, o aplicativo não deve exigir que o usuário:

* observe o mapa continuamente;
* procure territórios;
* procure parceiros;
* procure recompensas;
* abra missões;
* resgate benefícios;
* veja anúncios;
* compre produtos;
* faça upgrade;
* navegue em menus;
* acompanhe animações;
* abra baús;
* tome decisões comerciais;
* retire o celular do bolso sem necessidade.

## 4.2 O usuário pode correr sem olhar a tela

A experiência deve funcionar quando:

* a tela está apagada;
* o aparelho está bloqueado;
* o aplicativo está em background;
* o usuário abriu outra aplicação;
* não há internet;
* o GPS oscila temporariamente;
* o processo da interface é recriado;
* o aplicativo é reaberto pela notificação;
* o aplicativo é reaberto pelo ícone;
* o usuário passa vários minutos sem interagir;
* o Android aplica restrições de bateria.

## 4.3 A interface durante a corrida deve ser mínima

A interface ativa deve priorizar somente:

* tempo;
* distância;
* pace;
* estado da corrida;
* qualidade crítica do GPS;
* pausa;
* retomada;
* finalização;
* informações essenciais de segurança.

Podem existir:

* áudio opcional;
* vibração opcional;
* feedback simples;
* notificação persistente;
* modo foco;
* mapa opcional;
* bloqueio contra toques acidentais.

Não devem existir interrupções promocionais.

## 4.4 Territórios são consequência, não obrigação visual

O usuário não precisa ficar caçando territórios pela tela enquanto corre.

O sistema deve registrar silenciosamente:

* territórios atravessados;
* territórios conquistados;
* territórios defendidos;
* áreas inéditas;
* disputas relevantes;
* mudanças no domínio territorial.

Esses resultados devem ser apresentados principalmente depois da atividade.

Modos específicos de exploração territorial podem existir futuramente, desde que sejam:

* escolhidos antes da corrida;
* seguros;
* opcionais;
* não intrusivos;
* compatíveis com áudio ou orientação mínima;
* incapazes de sugerir comportamento perigoso.

---

# 5. O PÓS-CORRIDA É O GAMEPLAY PRINCIPAL

Ao finalizar a atividade, a Wayper deve transformar os dados coletados em uma experiência de descoberta.

Essa experiência deve ser chamada oficialmente de:

# Relatório da Expedição

O Relatório da Expedição pode apresentar:

## Desempenho físico

* distância;
* duração;
* pace médio;
* velocidade;
* elevação;
* calorias estimadas;
* recordes pessoais;
* comparações;
* evolução recente.

## Mapa e trajeto

* rota;
* início;
* final;
* segmentos;
* pausas;
* replay;
* mapa compartilhável;
* imagem;
* traço PNG.

## Territórios

* conquistados;
* defendidos;
* perdidos;
* recuperados;
* inéditos;
* raros;
* área total;
* bairros dominados;
* mudanças no ranking territorial.

## Progressão

* XP;
* nível;
* conquistas;
* medalhas;
* streaks;
* missões;
* desafios;
* progressão de temporada;
* itens desbloqueados;
* skins;
* personalizações.

## Competição

* posição anterior;
* posição atual;
* usuários ultrapassados;
* ranking local;
* ranking por grupo;
* ranking semanal;
* ranking mensal;
* resultados de campeonatos.

## Recompensas

* recompensa interna;
* benefício Plus;
* item cosmético;
* prêmio de desafio;
* recompensa patrocinada;
* benefício de parceiro;
* acesso temporário;
* WayCoins, caso sejam aprovadas futuramente.

Nem todos esses blocos precisam ser implementados agora.

A arquitetura deve permitir adicionar cada um independentemente.

---

# 6. EXPERIÊNCIA DE REVELAÇÃO

A revelação pós-corrida deve ser:

* rápida;
* agradável;
* pulável;
* recuperável;
* persistente;
* modular;
* idempotente;
* acessível pelo histórico;
* compatível com resultados parciais;
* compatível com modo offline.

O usuário não pode perder uma corrida porque:

* uma animação falhou;
* um território demorou;
* o ranking estava offline;
* uma recompensa não carregou;
* uma API externa falhou;
* um anúncio não carregou;
* um gateway estava indisponível.

A interface deve conseguir mostrar estados honestos:

* processando territórios;
* calculando progressão;
* ranking pendente;
* sincronização pendente;
* recompensa indisponível temporariamente;
* processamento recuperável.

O relatório não deve ficar totalmente bloqueado esperando todos os cálculos.

---

# 7. SALVAMENTO E FINALIZAÇÃO

A ordem obrigatória da finalização deve ser:

1. usuário solicita finalização;
2. sistema bloqueia finalizações concorrentes;
3. snapshot canônico final é congelado;
4. dados mínimos são persistidos localmente;
5. corrida é marcada como finalizada;
6. interface recebe confirmação;
7. tarefa de processamento da expedição é criada;
8. territórios, XP, ranking, conquistas e recompensas são processados;
9. resultados parciais são persistidos;
10. sincronização remota acontece quando possível;
11. relatório é completado;
12. qualquer falha recuperável pode ser retomada.

Nenhum processamento derivado pode impedir o salvamento mínimo.

---

# 8. ESTRATÉGIA DE ANÚNCIOS

A Wayper não deve ter anúncios como principal modelo de negócio.

O produto não deve ser projetado para:

* maximizar impressões;
* interromper navegação;
* forçar anúncios em toda tela;
* criar incômodos artificiais;
* prejudicar a versão gratuita para vender remoção de anúncios.

Anúncios podem existir futuramente de forma limitada, controlada e secundária.

## 8.1 Onde anúncios nunca podem aparecer

Anúncios não podem aparecer:

* durante corrida ativa;
* durante corrida pausada;
* na notificação persistente;
* durante restauração da corrida;
* durante finalização;
* antes do save mínimo;
* em alerta de GPS;
* em tela de erro crítico;
* ao abrir o app pela notificação da corrida;
* sobre controles de pausa ou finalização;
* com áudio durante atividade;
* em modal obrigatório de pós-corrida;
* bloqueando o histórico;
* impedindo o acesso a dados já registrados.

## 8.2 Locais possíveis

Anúncios opcionais e não intrusivos podem futuramente aparecer em:

* feed;
* exploração;
* ranking;
* histórico;
* tela de desafios;
* descoberta de grupos;
* loja;
* área de parceiros;
* tela de recompensas;
* pós-relatório, depois de tudo salvo;
* espaços próprios claramente identificados.

## 8.3 Objetivo secundário dos anúncios

Os anúncios podem servir como incentivo complementar para o upgrade.

Entretanto:

* não devem ser o único motivo para assinar;
* a experiência gratuita deve continuar boa;
* o aplicativo não deve ser propositalmente irritante;
* a remoção de anúncios deve ser apenas um benefício entre vários;
* anúncios devem poder ser desativados por feature flag;
* falha na rede de anúncios nunca pode afetar o app;
* o provedor de anúncios deve estar desacoplado do domínio.

---

# 9. PLANOS WAYPER

A monetização principal deve ser baseada em planos com benefícios reais.

A arquitetura de entitlements deve suportar capabilities e papéis sem checks
espalhados. Ela não deve criar plano, schema ou fluxo específico para uma
hipótese. Os casos reconhecidos são:

* plano gratuito;
* Wayper Plus;
* Wayper Pro, somente se esse nome, segmento e valor forem oficialmente
  aprovados;
* acessos promocionais;
* benefícios temporários;
* usuários organizadores;
* parceiros;
* administradores.

Não espalhe verificações como:

```js
if (user.isPremium) {
  // ...
}
```

por telas e componentes.

Crie ou consolide um sistema central de:

* entitlements;
* capabilities;
* feature access;
* subscription state;
* benefícios;
* expiração;
* restauração;
* período promocional.

## 9.1 Plano gratuito

O plano gratuito deve permitir:

* registrar corridas;
* salvar atividades;
* acompanhar métricas essenciais;
* conquistar territórios;
* participar de ranking básico;
* acessar progressão básica;
* visualizar histórico;
* participar da experiência central;
* receber recompensas permitidas;
* usar o app de forma respeitosa.

A versão gratuita não pode parecer uma demonstração quebrada.

## 9.2 Wayper Plus

Possíveis benefícios:

* ausência de anúncios;
* estatísticas avançadas;
* comparação entre períodos;
* heatmaps;
* histórico ampliado;
* replay avançado;
* exportações avançadas;
* relatórios de expedição completos;
* personalizações;
* skins;
* temas;
* desafios especiais;
* grupos avançados;
* criação de competições;
* metas avançadas;
* análises com IA;
* benefícios de parceiros;
* recursos sociais;
* armazenamento ou sincronização ampliada.

## 9.3 Wayper Pro

Caso seja criado, o Pro deve atender usuários mais avançados, organizadores ou comunidades.

Possíveis recursos:

* criação de eventos;
* criação de campeonatos;
* gestão de grupos;
* desafios privados;
* ligas;
* dashboards;
* gestão de participantes;
* relatórios;
* inscrições;
* premiações;
* ferramentas para influenciadores;
* monetização de desafios;
* funcionalidades empresariais.

Não criar o plano Pro apenas para duplicar o Plus com preço maior.

---

# 10. PARCEIROS E EMPRESAS

Empresas não devem ser tratadas como anunciantes comuns.

Elas devem ser tratadas como participantes da experiência da Wayper.

Possíveis papéis:

* patrocinador;
* parceiro local;
* parceiro esportivo;
* organizador;
* financiador de recompensa;
* patrocinador de temporada;
* patrocinador de desafio;
* patrocinador de território;
* fornecedor de benefício;
* fornecedor de produto;
* academia;
* loja esportiva;
* nutricionista;
* fisioterapeuta;
* personal trainer;
* organizador de corrida;
* marca esportiva;
* comunidade;
* influenciador.

## 10.1 Integração com o jogo

Parceiros podem futuramente:

* patrocinar temporadas;
* financiar recompensas;
* patrocinar territórios;
* criar desafios;
* patrocinar campeonatos;
* fornecer itens cosméticos;
* oferecer benefícios desbloqueados;
* oferecer inscrições;
* criar missões pós-corrida;
* financiar premiações;
* participar de campanhas de retenção;
* fornecer descontos relevantes;
* aparecer no Relatório da Expedição.

## 10.2 Momento correto

Parceiros devem aparecer:

* antes da atividade, em telas opcionais;
* depois da atividade;
* na área de desafios;
* na loja;
* na área de recompensas;
* no mapa de exploração fora da corrida;
* no relatório;
* em temporadas;
* em competições;
* em áreas próprias.

Não devem abordar o corredor no meio da atividade.

## 10.3 Parceiros locais

A ideia original de comércio local deve ser preservada, mas adaptada.

Exemplo incorreto:

> O usuário passou perto do Bar do Zé durante uma corrida de 21 km e recebeu uma interrupção pedindo para parar e consumir.

Exemplo correto:

> Depois da corrida, o usuário descobre que uma conquista ou desafio desbloqueou um benefício financiado pelo Bar do Zé.

Outro exemplo correto:

> Antes da corrida, o usuário opta por participar de uma rota, desafio ou evento patrocinado.

Outro exemplo correto:

> O parceiro aparece como recompensa opcional no Relatório da Expedição.

## 10.4 Métricas comerciais

A arquitetura futura deve permitir medir:

* campanha criada;
* recompensa financiada;
* recompensa exibida;
* recompensa desbloqueada;
* recompensa aberta;
* resgate iniciado;
* resgate concluído;
* conversão;
* recorrência;
* ticket;
* custo por resultado;
* retorno para o parceiro.

Não coletar dados pessoais ou localização detalhada sem necessidade e consentimento.

---

# 11. DESAFIOS, EVENTOS E CRIADORES

A Wayper deve estar preparada para pessoas e comunidades criarem experiências.

Possíveis atores:

* usuário comum;
* criador;
* influenciador;
* organizador;
* grupo;
* academia;
* empresa;
* marca;
* comunidade;
* organização esportiva.

Possíveis funcionalidades futuras:

* desafios públicos;
* desafios privados;
* desafios pagos;
* desafios patrocinados;
* campeonatos;
* ligas;
* eventos;
* temporadas;
* inscrições;
* premiações;
* rankings específicos;
* códigos de convite;
* comunidades;
* clubes;
* grupos empresariais.

A arquitetura deve considerar esses conceitos, mas não deve implementar todos prematuramente.

Crie limites de domínio e documentação suficiente para evitar que futuras implementações sejam acopladas diretamente às telas ou ao gateway.

---

# 12. PAGAMENTOS E GATEWAY

O gateway de pagamentos deve ser tratado como infraestrutura substituível.

Nenhuma regra de negócio deve importar diretamente o SDK de um gateway específico.

Crie ou planeje contratos para:

* pagamento;
* checkout;
* assinatura;
* renovação;
* cancelamento;
* estorno;
* split;
* repasse;
* pagamento de evento;
* pagamento de desafio;
* campanha patrocinada;
* restauração de compra;
* webhook;
* idempotência.

Possíveis interfaces conceituais:

* `PaymentGateway`;
* `SubscriptionProvider`;
* `CheckoutProvider`;
* `RefundProvider`;
* `PayoutProvider`;
* `PaymentEventHandler`.

Adapte os nomes ao padrão real do projeto.

## 12.1 Regras

* Não armazenar dados sensíveis de cartão.
* Não criar carteira financeira sem análise legal.
* Não criar moeda conversível em dinheiro.
* Não criar split sem regras contábeis e comerciais.
* Não confiar apenas no cliente para confirmar pagamentos.
* Não liberar entitlement apenas com retorno visual do checkout.
* Não processar webhook diretamente em componente mobile.
* Não acoplar gateway ao rastreamento.
* Não bloquear a corrida por falha financeira.
* Não integrar gateway real sem autorização explícita.

---

# 13. ECONOMIA INTERNA E RECOMPENSAS

A Wayper pode futuramente possuir uma economia interna.

Possíveis elementos:

* XP;
* níveis;
* pontos;
* itens;
* skins;
* medalhas;
* recompensas;
* moedas internas;
* temporadas;
* passes;
* desbloqueios;
* inventário.

WayCoins podem ser consideradas futuramente, mas devem inicialmente ser tratadas como hipótese.

Antes de implementar moeda interna, definir:

* origem;
* uso;
* expiração;
* limites;
* antifraude;
* valor;
* impossibilidade ou possibilidade de compra;
* possibilidade de transferência;
* implicações jurídicas;
* implicações contábeis;
* impacto em lojas de aplicativos.

Não implementar moeda financeira ou conversível sem análise específica.

## 13.1 Recompensas

Uma recompensa deve possuir:

* identificador;
* tipo;
* origem;
* campanha;
* elegibilidade;
* validade;
* quantidade;
* estoque;
* status;
* regras de resgate;
* idempotency key;
* registro de auditoria.

Possíveis tipos:

* XP;
* item;
* skin;
* medalha;
* benefício;
* desconto;
* acesso temporário;
* inscrição;
* Plus temporário;
* prêmio de desafio;
* recompensa patrocinada.

A recompensa não deve ser concedida diretamente por um componente visual.

---

# 14. ARQUITETURA DE DOMÍNIOS

Antes de criar pastas ou serviços, verifique o que já existe.

A arquitetura deve separar conceitualmente:

## Run Tracking

Responsável por:

* sessão ativa;
* GPS;
* tempo;
* distância;
* pace;
* rota;
* pausa;
* retomada;
* estado canônico;
* checkpoints;
* recuperação.

## Run Finalization

Responsável por:

* snapshot final;
* bloqueio de concorrência;
* persistência mínima;
* estado final;
* criação do processamento posterior.

## Expedition Processing

Responsável por:

* territórios;
* XP;
* ranking;
* recordes;
* conquistas;
* desafios;
* streaks;
* recompensas;
* eventos derivados.

O processamento deve ser:

* idempotente;
* retomável;
* versionado;
* observável;
* offline-first;
* independente da tela;
* compatível com resultado parcial.

## Expedition Report

Responsável por:

* representar resultados;
* combinar blocos;
* mostrar progresso;
* mostrar pendências;
* permitir reabertura;
* permitir replay;
* permitir compartilhamento.

## Progression

Responsável por:

* XP;
* níveis;
* conquistas;
* streaks;
* metas;
* desbloqueios;
* temporadas.

## Entitlements

Responsável por:

* plano gratuito;
* Plus;
* Pro, somente se aprovado;
* acesso promocional;
* recursos liberados;
* expiração;
* restauração.

## Commercial

Responsável por:

* parceiros;
* patrocinadores;
* campanhas;
* desafios patrocinados;
* recompensas patrocinadas;
* orçamento;
* limites;
* métricas comerciais.

## Payments Infrastructure

Responsável por:

* adaptadores;
* gateway;
* assinaturas;
* checkout;
* estorno;
* webhooks;
* conciliação.

## Ads Infrastructure

Responsável apenas por:

* provedor;
* disponibilidade;
* carregamento;
* exibição permitida;
* frequência;
* consentimento;
* falhas.

A regra de onde anúncios podem aparecer deve ficar numa política de domínio ou aplicação, não espalhada pelas telas.

---

# 15. POLÍTICA CENTRAL DE ANÚNCIOS

Crie ou planeje uma política central semelhante a:

```text
canShowAd(context, userEntitlements, appState)
```

A política deve considerar:

* atividade ativa;
* atividade pausada;
* finalização;
* save mínimo;
* navegação;
* usuário Plus;
* frequência;
* consentimento;
* ambiente;
* feature flag;
* provedor disponível.

Não espalhar chamadas diretas de anúncio em componentes.

O domínio da corrida não deve conhecer anúncios.

---

# 16. FEATURE FLAGS

Crie ou consolide uma estratégia central de feature flags.

Possíveis flags:

* novo relatório de expedição;
* progressão;
* XP;
* conquistas;
* streaks;
* recompensas;
* parceiros;
* desafios;
* anúncios;
* Plus;
* Pro, somente se a hipótese for aprovada;
* gateway;
* pagamentos;
* loja;
* temporadas;
* WayCoins;
* territórios patrocinados.

As flags devem permitir:

* desligamento emergencial;
* ativação por ambiente;
* testes;
* rollout gradual;
* compatibilidade;
* desenvolvimento incremental.

Não espalhar condicionais arbitrárias.

---

# 17. CONTEXTO PERMANENTE PARA AGENTES DE IA

Crie ou atualize o `AGENTS.md`.

O `AGENTS.md` deve conter de forma curta e obrigatória:

* ordem das fontes;
* nova visão oficial;
* regra “a corrida é a ação; o pós-corrida é o jogo”;
* prioridade do tracking;
* funcionamento offline;
* proibição de anúncios durante corrida;
* Plus baseado em valor;
* parceiros como participantes da experiência;
* gateway desacoplado;
* proibição de duplicação;
* obrigação de ler documentação;
* obrigação de testar;
* obrigação de atualizar documentos;
* obrigação de trabalhar em fases.

Crie a estrutura:

```text
docs/product/
├── 00-visao-oficial.md
├── 01-principios-do-produto.md
├── 02-modelo-de-negocio.md
├── 03-planos-e-entitlements.md
├── 04-parcerias-e-patrocinios.md
├── 05-monetizacao-e-anuncios.md
├── 06-desafios-eventos-e-criadores.md
├── 07-experiencia-durante-a-corrida.md
├── 08-relatorio-da-expedicao.md
├── 09-economia-e-recompensas.md
├── 10-decisoes-aprovadas.md
├── 11-hipoteses-em-avaliacao.md
└── 12-criterios-para-novas-features.md
```

## 17.1 Status das ideias

Toda ideia deve possuir status:

* aprovada;
* aprovada conceitualmente;
* planejada;
* em validação;
* implementada;
* parcialmente implementada;
* descartada;
* bloqueada.

`Hipótese` descreve a natureza de uma ideia ainda não decidida, não acrescenta
outro status operacional a essa lista. Uma hipótese deve registrar, por exemplo,
status `em validação` ou `bloqueada` e continua sem autorizar produção. Já o
metadado de um documento pode usar `hipótese` para indicar que todo o seu
conteúdo tem essa natureza; consulte `docs/14-instrucoes-para-ia.md`.

Regras:

* “aprovada” pode orientar implementação;
* “aprovada conceitualmente” pode orientar arquitetura;
* “planejada” pode entrar no roadmap;
* “em validação” não autoriza código de produção;
* “descartada” não deve reaparecer sem nova decisão;
* “bloqueada” precisa registrar motivo.

## 17.2 Decisões já aprovadas

Registre como aprovadas:

1. A corrida é a ação e o pós-corrida é o jogo.
2. O usuário não precisa olhar o celular durante a corrida.
3. Tracking e salvamento possuem prioridade absoluta.
4. Territórios são processados como consequência da atividade.
5. O Relatório da Expedição será a principal experiência pós-corrida.
6. Anúncios não são o foco principal da monetização.
7. Não haverá anúncios durante corrida.
8. A versão gratuita deve continuar boa.
9. Plus deve oferecer benefícios positivos.
10. Parceiros devem melhorar o jogo.
11. Empresas não devem interromper o corredor.
12. Gateway deve ser desacoplado.
13. Pagamentos não fazem parte do domínio de tracking.
14. Novas funcionalidades devem ser implementadas incrementalmente.

## 17.3 Ideias aprovadas conceitualmente

Registre como aprovadas conceitualmente:

* Wayper Plus;
* recompensas patrocinadas;
* desafios patrocinados;
* temporadas patrocinadas;
* territórios patrocinados;
* parceiros locais;
* marcas esportivas;
* criadores;
* eventos;
* campeonatos;
* grupos;
* gateway de pagamentos;
* assinaturas;
* desafios pagos;
* marketplace futuro.

## 17.4 Hipóteses ainda não autorizadas

Registre como hipóteses:

* Wayper Pro, até decisão específica sobre segmento e valor distintos do Plus;
* WayCoins;
* baús;
* recompensas aleatórias;
* marketplace aberto;
* split;
* carteira;
* moeda conversível;
* passes de temporada;
* rewarded ads;
* anúncios pós-relatório;
* territórios comerciais compráveis.

---

# 18. ADRs OBRIGATÓRIAS

Crie ADRs para:

1. A corrida é a ação; o pós-corrida é o jogo.
2. Tracking offline-first.
3. Salvamento mínimo antes de processamento derivado.
4. Processamento de expedição idempotente.
5. Monetização fora da corrida.
6. Plus baseado em entitlements.
7. Parceiros como patrocinadores da experiência.
8. Gateway desacoplado.
9. Feature flags.
10. Recompensas fora da UI.
11. Anúncios como fonte secundária.

Cada ADR deve conter:

* contexto;
* problema;
* decisão;
* alternativas;
* consequências;
* riscos;
* critérios de revisão;
* impacto técnico;
* impacto comercial;
* impacto visual;
* impacto em testes.

---

# 19. AUDITORIA COMPLETA DO CÓDIGO

Antes de alterar produção, mapeie:

## Corrida

* início;
* contagem regressiva;
* pausa;
* retomada;
* finalização;
* cancelamento;
* recuperação;
* background;
* foreground;
* GPS;
* filtros;
* reconciliação;
* checkpoint;
* storage;
* sync;
* notificação;
* diagnóstico.

## UI ativa

* botões;
* mapas;
* zonas;
* ranking;
* pop-ups;
* modais;
* banners;
* exportações;
* compartilhamento;
* menus;
* animações;
* alertas;
* timers;
* listeners.

## Pós-corrida

* resumo;
* detalhes;
* histórico;
* replay;
* territórios;
* ranking;
* XP;
* conquistas;
* compartilhamento;
* exportação;
* sync;
* estados parciais.

## Monetização

Pesquise:

* Plus;
* Pro, se aprovado;
* premium;
* subscription;
* entitlement;
* ad;
* AdMob;
* banner;
* interstitial;
* payment;
* checkout;
* gateway;
* partner;
* sponsor;
* reward;
* campaign;
* coupon;
* marketplace.

## Arquitetura

Identifique:

* fontes duplicadas de estado;
* regras em componentes;
* serviços redundantes;
* acoplamento com Firebase;
* acoplamento com tela;
* trabalho pesado no caminho crítico;
* tarefas não retomáveis;
* side effects;
* concorrência;
* ausência de idempotência;
* dependências circulares;
* timers sem cancelamento;
* listeners duplicados.

Entregue tabela com:

* domínio;
* arquivo;
* função;
* responsabilidade;
* alinhamento;
* problema;
* gravidade;
* recomendação;
* fase.

---

# 20. MATRIZ DE ADERÊNCIA

Avalie:

1. corrida silenciosa;
2. tracking confiável;
3. tela apagada;
4. background;
5. offline;
6. finalização resiliente;
7. save mínimo;
8. processamento derivado;
9. relatório pós-corrida;
10. territórios;
11. progressão;
12. ranking;
13. entitlements;
14. anúncios;
15. parceiros;
16. pagamentos;
17. feature flags;
18. privacidade;
19. antifraude;
20. reutilização arquitetural.

Classifique cada pilar como:

* implementado;
* parcialmente implementado;
* planejado;
* ausente;
* contraditório;
* desconhecido.

Inclua evidências concretas.

---

# 21. ROADMAP REFATORADO

Atualize o roadmap para:

## Fase 1 — Fundação confiável

* tracking;
* background;
* offline;
* restauração;
* GPS;
* notificação;
* persistência;
* finalização;
* diagnóstico.

## Fase 2 — Pipeline da expedição

* snapshot;
* save mínimo;
* fila;
* idempotência;
* resultados parciais;
* retomada;
* territórios;
* XP;
* ranking.

## Fase 3 — Relatório da Expedição

* resumo modular;
* territórios;
* progressão;
* replay;
* compartilhamento;
* comparação;
* reabertura;
* offline.

## Fase 4 — Retenção

* conquistas;
* streaks;
* desafios;
* missões;
* temporadas;
* itens;
* personalização;
* grupos.

## Fase 5 — Wayper Plus

* entitlements;
* benefícios;
* paywall respeitoso;
* restauração;
* métricas;
* ausência de anúncios;
* recursos avançados.

## Fase 6 — Wayper Pro (condicional)

Esta fase só entra no roadmap executável se a hipótese for promovida por decisão
explícita sobre segmento e valor distintos do Plus. A lista abaixo não autoriza
implementação.

* organizadores;
* eventos;
* campeonatos;
* grupos avançados;
* gestão;
* dashboards;
* criadores.

## Fase 7 — Parceiros

* parceiros;
* campanhas;
* recompensas;
* desafios patrocinados;
* territórios patrocinados;
* analytics;
* resgates.

## Fase 8 — Pagamentos

* gateway;
* assinatura;
* checkout;
* webhook;
* estorno;
* conciliação;
* auditoria.

## Fase 9 — Ecossistema

* eventos pagos;
* desafios pagos;
* marketplace;
* split;
* criadores;
* temporadas comerciais.

Não implementar fases futuras antes da fundação.

---

# 22. TESTES OBRIGATÓRIOS

## Tracking

* início;
* pausa;
* retomada;
* finalização;
* tela apagada;
* background;
* foreground;
* offline;
* perda de GPS;
* restauração;
* processo reiniciado;
* finalização concorrente.

## Finalização

* save mínimo antes de território;
* save mínimo antes de XP;
* save mínimo antes de ranking;
* save mínimo antes de recompensa;
* save mínimo antes de sync;
* falha derivada não perde corrida;
* retomada;
* idempotência.

## Relatório

* parcial;
* completo;
* offline;
* reabertura;
* processamento pendente;
* falha recuperável;
* blocos ausentes;
* animação pulada.

## Entitlements

* gratuito;
* Plus;
* Pro, se aprovado;
* promocional;
* expirado;
* restauração;
* fornecedor indisponível.

## Anúncios

* nunca durante corrida;
* nunca durante pausa;
* nunca durante finalização;
* nunca antes do save;
* não aparece para Plus;
* falha do provedor não afeta app;
* frequência respeitada.

## Parceiros

* elegibilidade;
* validade;
* campanha encerrada;
* estoque;
* recompensa patrocinada;
* resgate;
* idempotência.

## Pagamentos

Use mocks.

Teste:

* sucesso;
* falha;
* timeout;
* cancelamento;
* retorno duplicado;
* idempotência;
* provedor ausente;
* webhook inválido;
* entitlement não liberado sem confirmação segura.

---

# 23. ANALYTICS

Defina eventos para:

## Corrida

* iniciada;
* pausada;
* retomada;
* restaurada;
* finalização solicitada;
* salva;
* falha de save;
* processamento iniciado;
* processamento concluído.

## Relatório

* aberto;
* fechado;
* pulado;
* replay aberto;
* território revelado;
* conquista aberta;
* recompensa aberta;
* compartilhamento iniciado.

## Planos

* oferta aberta;
* benefício visualizado;
* checkout iniciado;
* assinatura confirmada;
* cancelamento;
* restauração;
* conversão.

## Parceiros

* campanha atribuída;
* recompensa gerada;
* recompensa exibida;
* recompensa aberta;
* resgate iniciado;
* resgate concluído;
* conversão.

Não registrar coordenadas cruas ou dados sensíveis desnecessários.

---

# 24. REUTILIZAÇÃO EM PROJETOS FUTUROS

A Wayper deve servir como referência arquitetural, mas não virar um framework genérico prematuro.

Para isso:

* separar domínio e infraestrutura;
* abstrair fornecedores externos;
* evitar Firebase dentro de regras;
* evitar gateway dentro de telas;
* evitar anúncios dentro de componentes críticos;
* centralizar feature flags;
* centralizar entitlements;
* documentar decisões;
* criar interfaces para integrações;
* testar regras de negócio;
* evitar componentes gigantes;
* evitar singletons globais desnecessários;
* registrar como substituir:

  * Firebase;
  * storage;
  * mapa;
  * analytics;
  * anúncios;
  * gateway;
  * notificações.

Crie:

```text
docs/architecture/portability-and-reuse.md
```

Explique:

* partes específicas da Wayper;
* partes reutilizáveis;
* adaptadores;
* contratos;
* dependências;
* riscos de copiar código;
* exemplos de substituição.

---

# 25. ORDEM DE EXECUÇÃO

Não implemente tudo de uma vez.

Execute:

## Etapa A — Auditoria

* inventário;
* matriz;
* divergências;
* riscos;
* plano.

Não alterar produção.

## Etapa B — Contexto permanente

* `AGENTS.md`;
* documentos de produto;
* decisões;
* hipóteses;
* ADRs;
* roadmap;
* backlog.

## Etapa C — Segurança da corrida

* remover trabalho pesado;
* reduzir distração;
* consolidar tracking;
* reforçar background;
* reforçar offline;
* reforçar recuperação.

## Etapa D — Finalização

* snapshot;
* save mínimo;
* concorrência;
* fila;
* retomada;
* idempotência.

## Etapa E — Expedição

* territórios;
* XP;
* ranking;
* progressão;
* resultados parciais.

## Etapa F — Relatório

* blocos;
* reabertura;
* replay;
* compartilhamento;
* offline.

## Etapa G — Planos

* entitlements;
* gratuito;
* Plus;
* Pro, somente se a hipótese tiver sido promovida por decisão explícita;
* feature flags.

## Etapa H — Monetização futura

* anúncios;
* parceiros;
* campanhas;
* gateway;
* pagamentos.

Cada etapa deve possuir:

* escopo;
* arquivos;
* critérios de aceite;
* testes;
* riscos;
* rollback;
* commit próprio.

---

# 26. ENTREGA FINAL

Entregue:

## Diagnóstico executivo

* estado atual;
* aderência;
* conflitos;
* riscos;
* oportunidades.

## Mapa do código

* domínio;
* arquivos;
* funções;
* responsabilidade;
* problema;
* recomendação.

## Matriz de aderência

Com evidências.

## Documentação alterada

* arquivo;
* mudança;
* razão.

## Código alterado

* arquivo;
* mudança;
* impacto;
* risco;
* rollback.

## Arquitetura resultante

Explique:

* tracking;
* finalização;
* expedição;
* relatório;
* progressão;
* entitlements;
* anúncios;
* parceiros;
* pagamentos.

## Testes

* comandos;
* resultados;
* falhas;
* validações físicas pendentes.

## Roadmap

Dividido em tarefas pequenas.

## Commits sugeridos

Separados por fase.

---

# 27. RESTRIÇÕES FINAIS

* Não reescrever o projeto inteiro.
* Não implementar todas as fases numa execução.
* Não duplicar serviços.
* Não criar arquitetura paralela.
* Não transformar a Wayper em app de anúncios.
* Não mostrar anúncios durante corrida.
* Não degradar artificialmente o gratuito.
* Não usar Plus apenas como remoção de anúncios.
* Não interromper o corredor com parceiro.
* Não exigir celular na mão.
* Não acoplar gateway ao tracking.
* Não acoplar anúncio ao domínio.
* Não liberar entitlement sem confirmação segura.
* Não processar recompensa na UI.
* Não duplicar XP.
* Não duplicar território.
* Não duplicar ranking.
* Não criar moeda financeira.
* Não expor dados sensíveis.
* Não declarar teste físico sem executar.
* Não esconder riscos.
* Não implementar hipótese como decisão aprovada.

A regra final para qualquer alteração futura é:

> Durante a corrida, confiabilidade absoluta e mínima interação. Depois da corrida, descoberta, progressão, competição e recompensa.

Toda nova funcionalidade deve responder:

1. Melhora a experiência principal?
2. Obriga o usuário a olhar o celular durante a corrida?
3. Pode causar perda de atividade?
4. Funciona offline?
5. Está no domínio correto?
6. Está acoplada a fornecedor externo?
7. Fortalece o Relatório da Expedição?
8. Cria valor real para Plus ou Pro?
9. Permite participação de parceiros sem prejudicar o usuário?
10. Pode ser desativada por feature flag?
11. Possui testes?
12. Está aprovada ou ainda é hipótese?

Se uma funcionalidade contradizer a visão, não implemente silenciosamente.

Registre o conflito, explique o risco e proponha uma alternativa alinhada.
