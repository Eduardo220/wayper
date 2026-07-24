# ADRs da direção oficial

**Data da decisão:** 2026-07-24  
**Status geral:** aceito

Estas decisões complementam os ADRs históricos em
[`docs/08-decisoes-tecnicas.md`](../08-decisoes-tecnicas.md). Uma decisão
conceitual define limites arquiteturais, mas não autoriza por si só uma integração
de produção.

## ADR-028 — A corrida é a ação; o pós-corrida é o jogo

**Status:** aceito

- **Contexto:** a Wayper já registra atividades e possui território, XP, ranking,
  replay e share, mas a experiência ainda concentra mapa e captura durante a
  corrida.
- **Problema:** exigir atenção durante esforço reduz segurança e fragmenta a
  descoberta.
- **Decisão:** a tela ativa registra e protege; a revelação das consequências
  acontece no Relatório da Expedição.
- **Alternativas:** manter mapa territorial como gameplay principal; transformar
  a Wayper em tracker convencional. Ambas foram rejeitadas.
- **Consequências:** modo foco, mapa opcional e módulos pós-corrida independentes.
- **Riscos:** reduzir feedback percebido ou esconder estado crítico.
- **Critérios de revisão:** evidência de que feedback territorial seguro durante a
  atividade aumenta valor sem exigir atenção.
- **Impacto técnico:** separar tracking, finalização, processamento e relatório.
- **Impacto comercial:** ofertas e parceiros migram para momentos opcionais.
- **Impacto visual:** atividade mínima; pós-corrida rico e modular.
- **Impacto em testes:** validar corrida sem olhar a tela e relatório parcial.

## ADR-029 — Tracking offline-first

**Status:** aceito

- **Contexto:** `activeRunTrackingService`, tarefa headless e checkpoints locais
  já formam a base canônica.
- **Problema:** rede, UI ou Firestore não são confiáveis durante exercício.
- **Decisão:** sessão, GPS, tempo, rota, pausa e recuperação são locais; rede é
  posterior.
- **Alternativas:** backend como fonte primária ou componente como store. Ambas
  comprometem offline/background.
- **Consequências:** persistência e reconciliação local continuam obrigatórias.
- **Riscos:** divergência entre cópias locais e pressão de armazenamento.
- **Critérios de revisão:** somente mudança de plataforma que ofereça garantia
  superior sem dependência de rede.
- **Impacto técnico:** nenhum SDK comercial no caminho do GPS.
- **Impacto comercial:** indisponibilidade de parceiro/plano não afeta atividade.
- **Impacto visual:** UI reflete o estado canônico, não o controla.
- **Impacto em testes:** tela bloqueada, background, processo recriado, GPS
  oscilante e offline.

## ADR-030 — Salvamento mínimo antes de processamento derivado

**Status:** aceito

- **Contexto:** a finalização atual já salva localmente antes da fila derivada.
- **Problema:** território, XP, ranking, sync ou animação podem falhar/demorar.
- **Decisão:** congelar snapshot, persistir e confirmar o mínimo, marcar a corrida
  finalizada e só então criar processamento derivado.
- **Alternativas:** transação monolítica; aguardar backend. Rejeitadas por perda e
  latência.
- **Consequências:** resultados podem aparecer como pendentes.
- **Riscos:** relatório incompleto se a fila não for retomada.
- **Critérios de revisão:** não aplicável enquanto a atividade precisar sobreviver
  offline.
- **Impacto técnico:** orquestrador idempotente e contrato `minimumSavedRun`.
- **Impacto comercial:** anúncio, recompensa e checkout nunca antecedem o save.
- **Impacto visual:** confirmação rápida seguida de estados parciais.
- **Impacto em testes:** concorrência, crash em cada etapa e reprocessamento.

## ADR-031 — Processamento da Expedição idempotente

**Status:** aceito

- **Contexto:** a fila pós-corrida possui tentativas e idempotência parcial.
- **Problema:** reinício ou rede instável pode repetir território, XP e recompensa.
- **Decisão:** trabalhos derivados são versionados, persistidos, retomáveis,
  observáveis e idempotentes por corrida/módulo.
- **Alternativas:** processamento apenas em memória; “executar uma vez”. Não
  sobrevivem a falhas reais.
- **Consequências:** cada módulo mantém status, versão, tentativas e resultado.
- **Riscos:** schemas complexos e migração da fila atual.
- **Critérios de revisão:** após telemetria provar passos desnecessários, sem
  remover idempotência.
- **Impacto técnico:** evoluir a fila existente, não criar outra.
- **Impacto comercial:** concessões e métricas não duplicam.
- **Impacto visual:** módulos atualizam independentemente.
- **Impacto em testes:** retry, duplicidade, ordem parcial e atualização de versão.

## ADR-032 — Monetização fora da corrida

**Status:** aceito

- **Contexto:** assinatura, parceiros e anúncios são direções futuras.
- **Problema:** monetização no esforço ameaça segurança e confiança.
- **Decisão:** ofertas, anúncios, parceiros, checkout e resgate ficam fora de
  atividade ativa/pausada, recuperação e finalização.
- **Alternativas:** interstitial de pausa/finalização; oferta geolocalizada durante
  a rota. Rejeitadas.
- **Consequências:** menos inventário, maior qualidade de contexto.
- **Riscos:** pressão futura por receita pode tentar contornar a política.
- **Critérios de revisão:** a zona proibida não é revisável por experimento
  comercial; novos locais exigem ADR.
- **Impacto técnico:** política central e estado de atividade como bloqueio.
- **Impacto comercial:** receita privilegia assinatura e experiências opcionais.
- **Impacto visual:** nenhuma promoção em controles ou alertas críticos.
- **Impacto em testes:** matriz negativa para todos os estados da corrida.

## ADR-033 — Plus baseado em entitlements

**Status:** aceito conceitualmente

- **Contexto:** Plus é a principal direção de monetização, ainda sem implementação.
- **Problema:** `isPremium` espalhado cria inconsistência, acoplamento e falhas
  offline.
- **Decisão:** resolver capabilities em um domínio central, com expiração,
  promoções, restauração e último estado conhecido.
- **Alternativas:** booleano no usuário; checks diretos nas telas. Rejeitadas.
- **Consequências:** cada benefício pode evoluir e ser testado isoladamente.
- **Riscos:** cache conceder ou negar acesso temporariamente de modo incorreto.
- **Critérios de revisão:** quando requisitos de loja/backend estiverem definidos.
- **Impacto técnico:** contrato/provider e fallback conservador offline.
- **Impacto comercial:** pacote de valor mensurável e restaurável.
- **Impacto visual:** oferta explica capabilities, sem bloquear dados básicos.
- **Impacto em testes:** expiração, restauração, promo, offline e mudança de plano.

## ADR-034 — Parceiros patrocinam a experiência

**Status:** aceito conceitualmente

- **Contexto:** parceiros locais e esportivos podem financiar experiências.
- **Problema:** pins, cupons e interrupções transformariam o produto em mapa
  comercial.
- **Decisão:** parceiros entram por desafio escolhido, temporada, evento ou
  recompensa pós-corrida.
- **Alternativas:** proximidade comercial durante corrida; banner genérico.
  Rejeitadas como direção central.
- **Consequências:** campanhas precisam de elegibilidade, contexto e métricas.
- **Riscos:** influência indevida sobre competição ou privacidade.
- **Critérios de revisão:** integridade do jogo, consentimento e valor ao usuário.
- **Impacto técnico:** domínio Commercial desacoplado de tracking e provider.
- **Impacto comercial:** venda baseada em resultado, não mera impressão.
- **Impacto visual:** identificação clara e presença em áreas opcionais.
- **Impacto em testes:** elegibilidade, estoque, expiração, falha e privacidade.

## ADR-035 — Gateway de pagamentos desacoplado

**Status:** aceito conceitualmente

- **Contexto:** assinaturas, eventos e desafios pagos podem exigir pagamentos.
- **Problema:** SDK em telas/regras impede troca, auditoria e confirmação segura.
- **Decisão:** gateway é adapter de infraestrutura; backend/webhook confirma
  eventos idempotentes antes de conceder acesso.
- **Alternativas:** chamar SDK direto na UI; confiar no retorno do checkout.
  Rejeitadas.
- **Consequências:** contratos para assinatura, checkout, refund e eventos.
- **Riscos:** complexidade operacional, fiscal, lojas e conciliação.
- **Critérios de revisão:** antes de escolher provedor ou suportar split/payout.
- **Impacto técnico:** nenhum dado de cartão ou webhook no app mobile.
- **Impacto comercial:** troca de provedor e restauração ficam possíveis.
- **Impacto visual:** UI reage a estados do domínio, não do SDK.
- **Impacto em testes:** duplicidade, webhook fora de ordem, cancelamento, refund e
  restauração.

## ADR-036 — Feature flags centralizadas

**Status:** aceito

- **Contexto:** relatório, progressão e integrações comerciais serão incrementais.
- **Problema:** condicionais dispersas dificultam kill switch e rollback.
- **Decisão:** uma política central resolve flags por ambiente, rollout e fallback
  local conhecido.
- **Alternativas:** constantes por tela; remoção de código para desligar. Rejeitadas.
- **Consequências:** toda feature de risco declara flag, default e comportamento
  offline.
- **Riscos:** combinações inválidas e dependência excessiva de configuração remota.
- **Critérios de revisão:** simplificar flags estabilizadas após rollout completo.
- **Impacto técnico:** resolver central sem colocar rede no tracking.
- **Impacto comercial:** desligamento emergencial de ads, pagamentos e parceiros.
- **Impacto visual:** variantes coerentes, sem piscar conteúdo indisponível.
- **Impacto em testes:** defaults, ambiente, cache, dependências e kill switch.

## ADR-037 — Recompensas fora da UI

**Status:** aceito

- **Contexto:** recompensas futuras podem vir de progressão, desafio ou parceiro.
- **Problema:** conceder ao abrir/completar animação duplica e permite abuso.
- **Decisão:** domínio/processamento avalia e concede com idempotency key e
  auditoria; UI apenas apresenta/resgata por comando.
- **Alternativas:** estado local do componente; concessão por callback visual.
  Rejeitadas.
- **Consequências:** animação pode ser pulada sem perder recompensa.
- **Riscos:** regras distribuídas entre domínio local e autoridade remota.
- **Critérios de revisão:** ao definir tipos financeiros ou transferíveis.
- **Impacto técnico:** ledger/status e comando idempotente.
- **Impacto comercial:** estoque, campanha e atribuição auditáveis.
- **Impacto visual:** estados pendente, disponível, resgatada e indisponível.
- **Impacto em testes:** reabertura, retry, duas telas, estoque e expiração.

## ADR-038 — Anúncios como fonte secundária

**Status:** aceito conceitualmente

- **Contexto:** anúncios podem complementar receita, mas não definem o produto.
- **Problema:** maximizar impressões degrada Free e conflita com segurança.
- **Decisão:** ads são opcionais, não intrusivos, desligáveis, fora da corrida e
  subordinados a política, consentimento, frequência, flags e entitlements.
- **Alternativas:** produto ad-first; remover ads como único valor de Plus.
  Rejeitadas.
- **Consequências:** provider pode falhar sem efeito funcional.
- **Riscos:** rastreamento de terceiros, consentimento e pressão de frequência.
- **Critérios de revisão:** antes de integrar SDK ou testar novo placement.
- **Impacto técnico:** provider isolado; nenhum import no domínio de corrida.
- **Impacto comercial:** menor inventário, foco em assinatura e contexto.
- **Impacto visual:** espaços identificados e nunca modais obrigatórios.
- **Impacto em testes:** política por contexto, Plus, consentimento, frequência,
  offline, falha e kill switch.
