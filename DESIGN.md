# Wayper Design Contract

> **Status:** vigente<br>
> **Escopo:** identidade visual e comportamento de interface do app mobile<br>
> **Runtime tokens:** [`src/theme/wayperTheme.js`](src/theme/wayperTheme.js)<br>
> **Evidência da baseline:**
> [`docs/audits/2026-08-23-design-intelligence.md`](docs/audits/2026-08-23-design-intelligence.md)

## Autoridade e precedência

```text
PRODUCT TRUTH
docs/product/ + decisões aprovadas
        ↓ define o que a experiência precisa comunicar e proteger
DESIGN CONTRACT
DESIGN.md
        ↓ define significado, hierarquia, linguagem e guardrails
RUNTIME TOKENS
src/theme/wayperTheme.js
        ↓ define valores executáveis; colors.js mantém aliases de compatibilidade
COMPONENT IMPLEMENTATION
src/components/ui/ + componentes e telas atuais
        ↓ materializa o contrato e pode revelar drift, não redefini-lo
```

- Produto não escolhe hex, radius ou animação local; define prioridades e
  invariantes. O princípio central é **a corrida é a ação; o pós-corrida é o
  jogo**.
- Este documento é o único contrato visual normativo. Ele não substitui verdade
  funcional, regra de produto ou semântica de plataforma.
- `WayperTheme` é o único owner dos valores globais executáveis. Este documento
  registra papéis e mapeamentos, mas uma alteração física deve acontecer no
  theme e ser refletida aqui, não duplicada em outro arquivo de tokens.
- `src/theme/colors.js` é uma camada de aliases para consumidores existentes,
  não uma paleta concorrente.
- `src/components/ui/` é o kit incremental atual. Implementação local prevalece
  para descrever o estado da branch; divergência contra este contrato é dívida a
  validar, não autorização para redesign oportunista.
- Android possui semântica de sistema, gestos e adaptação. A Wayper tematiza a
  experiência sem substituir esses contratos.
- Screenshots antigos e `docs/09-design-e-wireframes.md` são referência
  histórica/funcional. Não definem a identidade atual quando divergem do runtime.

## Princípios visuais

1. **Mapa e movimento são matéria do produto.** Rota, posição, território,
   distância e estado real têm prioridade sobre ornamento.
2. **Quieto durante, expressivo depois.** Corrida ativa reduz carga cognitiva;
   impacto visual é reservado a resultado, conquista e evolução.
3. **Escuro atlético, não neon indiscriminado.** Superfícies profundas e o
   verde elétrico formam a identidade atual. Cyan, warning, danger, glow e
   gradiente precisam de papel, nunca de preenchimento decorativo.
4. **Estado antes de aparência.** Offline, loading, empty, erro, permissão e
   retry fazem parte do design. Nenhum acabamento mascara dado ausente ou falha.
5. **Competição honesta.** Ranking, território, XP, medalha e recompensa só
   recebem ênfase quando o dado é real ou explicitamente local/cacheado.
6. **Uma linguagem, extraída aos poucos.** Reutilize token/componente quando o
   padrão já existe; não generalize uma exceção nem faça migração visual ampla
   dentro de uma mudança local.

## Modos de experiência

O modo é decidido pela superfície ou momento, não pelo produto inteiro.

### OPERATE

É o default para corrida ativa, ranking, missões, perfil, configurações,
amigos, grupos, histórico, dashboards, formulários, listas e navegação.

- Sucesso significa entender estado e concluir uma tarefa com pouca atenção.
- Hierarquia, consistência, toque seguro e recuperação superam expressão.
- Verde marca ação primária, seleção ou estado vivo verdadeiro; não decora cada
  card.
- Motion explica feedback, estado e continuidade. Entradas coreografadas,
  pulses contínuos e glow repetido são ruído.
- Densidade é permitida quando a decisão exige comparação, mas cards aninhados
  não substituem agrupamento, títulos e divisores.

### EXPERIENCE

É uma janela curta dentro do fluxo para corrida concluída, território
conquistado, medalha desbloqueada, missão cumprida, level up, recompensa e hero
do pós-corrida.

- Sucesso significa reconhecer o que aconteceu, por que importa e o próximo
  objetivo.
- Uma composição focal pode usar escala, cor, profundidade e motion mais fortes.
- A celebração termina e devolve controle; conteúdo e ações continuam legíveis.
- Não transformar ranking, formulário ou relatório inteiro em espetáculo.
- Um resultado parcial, indisponível ou falho não deve fingir celebração.

## Cores semânticas

Os nomes abaixo são papéis do contrato. O mapping aponta para o owner atual;
valores físicos continuam em `WayperTheme`.

| Papel | Mapping atual | Uso |
| --- | --- | --- |
| `surface-base` | `colors.background` | fundo principal escuro |
| `surface-base-alt` | `colors.backgroundAlt` | variação de fundo e transição estrutural |
| `surface-raised` | `colors.surfaceElevated` | sheets, modais e containers elevados |
| `surface-default` | `colors.surface` | cards e blocos de conteúdo |
| `surface-soft` | `colors.surfaceSoft` | controles e agrupamentos secundários |
| `surface-muted` | `colors.surfaceMuted` | estado de menor ênfase |
| `accent-primary` | `colors.primary` | ação principal, seleção e tracking válido |
| `accent-primary-soft` | `colors.primarySoft` | fundo de ênfase sem competir com texto |
| `accent-secondary` | `colors.cyan` | contraste informacional seletivo |
| `text-primary` | `colors.text` | conteúdo principal |
| `text-secondary` | `colors.textMuted` | apoio ainda legível |
| `text-subtle` | `colors.textSubtle` | metadado; nunca informação crítica |
| `text-on-accent` | `colors.textInverse` | texto sobre verde claro |
| `state-success` | `colors.primary` na baseline | sucesso/confirmado quando não confunde com ação |
| `state-warning` | `colors.warning` | atenção recuperável, pause ou GPS limitado |
| `state-danger` | `colors.danger` | finalização destrutiva, erro ou perda potencial |
| `territory-owned` | cor do território + tratamento `isMine` no MapLibre | propriedade do usuário, reforçada por opacity/stroke |
| `territory-other` | cor real do owner com menor ênfase | território de outro usuário sem apagar identidade |
| `route-active` | `map.routeColor` | rota/tracking em andamento |

Regras:

- Preserve contraste de texto e controles em todos os estados. Não use apenas
  cor para comunicar owner, erro, pausa ou seleção.
- Logo e assets podem conter gradiente lime/verde/cyan; isso não licencia
  gradiente em todo CTA, texto ou superfície.
- Danger é semântico, não decorativo. Cyan não é um segundo primary.
- Cores de usuário/território são dados; sanitize e forneça fallback antes de
  renderizar, sem sobrescrever arbitrariamente a identidade do owner.
- Hardcode local só é aceitável para material específico sem papel global. Se o
  mesmo significado reaparecer, promova ao theme antes de copiar.

## Tipografia

- A baseline usa a fonte do sistema. `expo-font` está instalado, mas nenhuma
  família customizada é carregada no app atual.
- `WayperTheme.typography` possui os papéis executáveis `screenTitle`, `title`,
  `subtitle`, `body`, `label`, `caption` e `button`.
- Dados de corrida e ranking podem ganhar peso e numerais grandes; labels ficam
  menores, porém não podem esconder unidade, período ou estado.
- Preserve font scaling do sistema. Não introduza `allowFontScaling={false}`;
  truncamento e `adjustsFontSizeToFit` são último recurso para artefatos de
  exportação, não solução geral de layout.
- Use sentence case para copy corrente. Uppercase/tracking pequeno é reservado
  a status curto ou dado realmente categórico; não criar eyebrow sobre todo
  heading.
- Um papel tipográfico deve ser estável entre telas. Antes de inventar tamanho e
  weight, procure papel existente; extraia novo papel só quando a diferença for
  repetida e semântica.

## Espaçamento e layout

- A escala executável é `2, 4, 8, 12, 16, 22, 30`, com `22` para margem de
  página. Combine passos existentes antes de adicionar valor.
- Agrupe conteúdo relacionado com espaço menor e separe seções com espaço maior.
  Não aplique o mesmo gap em todos os níveis.
- O contrato atual de entrega é phone/portrait. Isso descreve a configuração,
  não autoriza layout rígido: conteúdo deve sobreviver a largura compacta,
  teclado e font scale maior.
- Tablets, landscape, multi-window e foldables exigem composição por window
  size, nunca uma tela de telefone esticada ou checks por modelo. São alvos de
  validação futura, não suporte alegado nesta baseline.
- Áreas persistentes respeitam safe areas e insets. Overlays do mapa reservam
  espaço para controles críticos e não dependem de coordenada fixa que colida
  com status/navigation bars.

## Formas, superfícies e profundidade

- A escala de radius atual é `6, 10, 14, 18, 24, 30` e `pill`.
- Pills pertencem a ações, chips e status compactos. Cards grandes usam radius
  estrutural; não transforme todo container em cápsula.
- Profundidade padrão vem primeiro de superfícies tonais. `shadows.card` separa
  elevação real; glows de primary/danger são ênfase rara.
- Um card não precisa simultaneamente de border forte, shadow e glow. Escolha o
  mínimo que torne hierarquia/estado legível.
- Glass/blur, halos e gradientes não são fundos neutros. Use somente quando o
  material ou transição justificar e o custo no device for aceitável.

## Linguagem de componentes

O kit `src/components/ui/` é incremental: `WPButton`, `WPCard`, `WPChip`,
`WPInput`, `WPHeader`, `WPScreen`, `WPBottomSheet`, `WPMetricCard` e
`WPSectionTitle` são os primeiros owners compartilhados, não cobertura universal.

- **Botões:** um primary claro por região. Secondary/ghost mantêm hierarquia;
  danger exige consequência real. Estado disabled continua perceptível e
  semanticamente exposto.
- **Cards:** agrupam uma unidade de leitura/ação. Cards dentro de cards pedem
  primeiro flattening por spacing, divider ou seção.
- **Chips:** filtro, seleção ou ação compacta. Texto e estado não dependem só da
  cor.
- **Inputs:** label estável, foco visível, erro perto do campo e conteúdo
  preservado após falha.
- **Sheets/dialogs:** sheet para escolha/contexto móvel; dialog somente quando a
  decisão precisa interromper. Android Back e toque no backdrop fecham quando a
  ação é cancelável; decisões destrutivas não fecham ambiguamente.
- **Navigation:** padrões do React Navigation e do sistema são base. Marca entra
  no tema/header, não em gestos reinventados.
- **Estados:** use `src/components/states` para empty, loading, error, offline,
  permission e retry quando não existir componente consolidado mais específico.

Extração exige ao menos um destes sinais: repetição real com o mesmo propósito,
correção sistêmica necessária, accessibility/estado que precisa ser único, ou
redução comprovável de drift. Aparência parecida com intenções distintas não é
razão suficiente.

## Contrato nativo Android

**Android owns:** Back/predictive Back, edge-to-edge e insets, IME/teclado,
TalkBack, font scale, touch semantics, window classes, system bars, gestures,
sheet/dialog semantics, orientação, multi-window e foldable posture.

**Wayper owns:** paleta, hierarquia, linguagem de mapa/território, forma dos
componentes, voz de motion e intensidade de gamificação dentro dessas regras.

Requisitos para mudança visual relevante:

- Android Back deve fechar o overlay cancelável ou navegar conforme a pilha;
  nunca prender usuário nem criar um segundo caminho de back.
- Respeitar status, navigation, cutout e IME insets. `adjustPan` atual é estado
  observado, não prova de correção para todo formulário.
- Alvo de toque Android: pelo menos `48 × 48 dp`, com espaço suficiente; `hitSlop`
  pode ampliar área sem alterar aparência.
- Texto continua escalável e precisa ser testado em pelo menos `1.3x` quando o
  diff altera layout ou copy crítica.
- Pressables têm role, nome e estado acessíveis; mudança dinâmica relevante é
  anunciada sem spam.
- Tema dark é a única scheme configurada hoje. Não alegar light/dynamic color
  sem implementação e validação próprias.
- Mudança adaptativa precisa testar as window sizes suportadas; até existir
  contrato de tablet/foldable, tratar esses targets como gap conhecido.
- Mudança relevante de gesto, inset, teclado, motion ou performance só recebe
  validação final com emulador e, quando o risco depender de hardware, aparelho
  físico. Screenshot de browser não prova UI nativa.

## Motion grammar

Motion sempre comunica `state`, `progress`, `ownership`, `reward` ou transição
espacial. Removê-la deve perder significado ou caráter de um momento ganho.

| Classe | Job | Faixa orientativa | Exemplos permitidos |
| --- | --- | ---: | --- |
| `MICRO` | reconhecer toque/seleção | 100–150 ms | press scale discreto, feedback de chip, icon state |
| `STANDARD` | explicar mudança rotineira | 150–300 ms | pause/resume, tab/filter, expansão curta |
| `REVEAL` | organizar resultado/continuidade | 300–500 ms | módulo do relatório ficando ready, sheet/view transition |
| `CELEBRATION` | marcar recompensa merecida | 500–800 ms, uma sequência focal | território, medalha, missão, level up |

- Exit é mais rápido que entrance. Springs/bounce só quando a física e o
  significado justificarem; não por default.
- Loops não essenciais param quando ocultos/offscreen. Pulse contínuo é aceito
  somente para estado realmente vivo e precisa permanecer compreensível parado.
- OPERATE usa `MICRO` e `STANDARD`; `REVEAL` é pontual. `CELEBRATION` pertence a
  uma janela EXPERIENCE e não bloqueia save, leitura ou próxima ação.
- Toda motion nova tem caminho reduced-motion: preserve estado/feedback por
  opacity, color ou cut, reduzindo deslocamento e repetição. A baseline ainda
  não centraliza essa preferência; isso é dívida conhecida.
- Use `Animated`, Moti/Reanimated ou Skia já instalados conforme o owner atual.
  Não adicione dependência para efeito expressável pelo stack existente.

## Linguagem do mapa

O mapa é superfície primária quando a tarefa é espaço, rota ou território. Ele
não é background decorativo.

Hierarquia:

1. posição, rota e estado de tracking;
2. controles de pause/resume/finalize e alerta crítico de GPS;
3. território/zonas relevantes ao modo atual;
4. métricas mínimas;
5. navegação, exploração e detalhes secundários.

- Overlays deixam a geometria útil visível e evitam competir entre topo, bottom
  dock, banners, sheets e recenter.
- Durante corrida, o approved direction é modo foco com tempo, distância, pace,
  estado e GPS crítico; mapa é opcional. O runtime atual ainda é map-first e não
  mostra pace no painel mínimo, portanto isso é gap de produto/design, não
  licença para alterar a corrida numa tarefa de styling.
- Owner e seleção usam também stroke, opacity, label ou shape; cor isolada não
  basta.
- Gestos de mapa permanecem previsíveis. Overlay não deve roubar pan/zoom fora
  do próprio alvo e ações críticas não dependem de gesture invisível.
- Captura/share/replay podem reconfigurar composição, mas não mudar a semântica
  dos dados nem bloquear tracking/save.

## Gamificação e pós-corrida

Ranking, progressão, território, missão, recompensa e medalha compartilham a
mesma gramática: **resultado real → significado → evolução → próximo objetivo**.

O Relatório da Expedição é composição modular, não uma tela monolítica nem gate
do save. Cada módulo pode estar `pending`, `processing`, `ready`,
`failed_retryable`, `failed_permanent` ou `not_applicable`.

Ordem visual recomendada, conforme dado disponível:

1. confirmação local de corrida salva/concluída;
2. hero de resultado físico: distância, tempo, pace e trajeto;
3. território novo/mantido/perdido;
4. XP, nível e evolução;
5. ranking semanal;
6. missão/progresso e missão cumprida;
7. recompensa/medalha;
8. próximo objetivo e ações secundárias.

- Uma conquista `ready` pode abrir janela EXPERIENCE; módulos pendentes ou
  falhos permanecem OPERATE e explicam retry/continuidade.
- Não somar cinco celebrações simultâneas. Priorize a maior consequência, agrupe
  resultados secundários e permita revisão no ritmo do usuário.
- `RunSummaryModal` atual cobre edição, métricas, território/XP parcial, esforço,
  tags, notas e foto. Ele ainda não é o relatório modular completo.
- `MedalsWidget` tem persistência/anúncio e identidade própria, mas emojis remotos
  e pulse/glow não definem um sistema global. Missões/rewards dedicados ainda
  não possuem superfície implementada.

## Acessibilidade e estados

- Todo Pressable precisa de target seguro, `accessibilityRole`, nome útil e
  estado quando selected/disabled/busy. Ícone sozinho sempre recebe nome.
- Ordem de leitura acompanha a hierarquia visual; foco retorna de sheet/modal ao
  controle de origem quando possível.
- Mudanças críticas — corrida pausada, erro de GPS, save confirmado, conquista —
  são anunciadas uma vez. Animação e cor não substituem texto/semântica.
- Contraste mínimo: texto comum 4.5:1; texto grande e componentes essenciais
  3:1. Validar no dark atual e em qualquer scheme futura.
- Copy de empty/error/permission informa estado, impacto e recuperação. Offline
  diz quando dado local/cacheado continua disponível.
- Conteúdo longo, nomes reais, números grandes, emoji e português com acentos
  precisam envolver/truncar sem esconder ação ou unidade.

## Do / don't

### Do

- Use o theme e componentes existentes antes de criar valor ou padrão local.
- Preserve mapa/tracking legíveis e controles críticos alcançáveis sem precisão.
- Reserve uma ênfase focal para o momento que mais merece recompensa.
- Verifique default, pressed, disabled, loading, error, empty, offline e
  permission conforme o componente.
- Catalogue drift visual e corrija por safe slice, com screenshot nativo e
  validação proporcional.

### Don't

- Não trate screenshot antigo, plugin ou detector externo como identidade.
- Não espalhe glow, neon, gradiente, pulse, partículas, 3D ou cards aninhados
  apenas por capacidade técnica.
- Não use EXPERIENCE durante corrida ativa nem em tarefas operacionais comuns.
- Não invente dado de ranking, território, presença, missão ou recompensa para
  preencher estado vazio.
- Não extraia design system durante mudança local sem repetição/owner provado.
- Não declare suporte a light mode, tablet, landscape, multi-window, foldable,
  reduced motion ou Predictive Back antes da implementação e prova nativas.

## Checklist de mudança

1. Classifique a superfície como OPERATE ou a janela como EXPERIENCE.
2. Carregue somente as capabilities de design necessárias pelo registry.
3. Confirme verdade de produto, token runtime, componente/caller e estados.
4. Preserve semântica Android e accessibility antes do acabamento.
5. Implemente o menor safe slice; não redesenhe vizinhos.
6. Valide source/gates e, quando houver UI funcional alterada, emulador/device
   nas condições relevantes.
7. Se surgir um padrão reutilizável, registre evidência antes de promover token,
   componente ou skill.
