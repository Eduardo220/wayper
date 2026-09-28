# Auditoria — Wayper Design Intelligence

> **Data:** 2026-08-23<br>
> **Branch:** `feat/wayper-ai-harness`<br>
> **Baseline Git:** `0b9a78d2f140bdda17db04fdc4e78f294ff952b5`<br>
> **Tipo:** evidência datada; não normativa<br>
> **Contrato resultante:** [`../../DESIGN.md`](../../DESIGN.md)

## Escopo e método

Auditoria source-first do app Expo/React Native, sem mudança funcional nem
redesign. Foram inspecionados theme/aliases, kit UI, telas e componentes,
MapLibre, navegação, run/post-run, ranking/progressão, estados, assets, motion,
configuração Expo/Android e documentação de produto. Screenshots antigos foram
vistos como evidência histórica, não como spec.

Não houve build, screenshot de emulador ou aparelho físico nesta unidade.
Portanto achados de acessibilidade, performance, adaptividade e conformance são
sinais confirmados no source/config, não uma certificação visual de release. Um
score sintético foi deliberadamente omitido: atribuir precisão sem runtime
contraria o próprio contrato de evidência adotado do audit nativo.

## Estado visual real

| Área | Estado observado | Owner atual | Gap / risco catalogado |
| --- | --- | --- | --- |
| Theme | `Wayper NeoPulse Dark`, superfícies profundas, verde `#00E676`, cyan, danger, warning, 7 passos de spacing/radius | `src/theme/wayperTheme.js` | alguns papéis sem alias semântico explícito; raw colors locais |
| Aliases | compatibilidade de cores e medalhas | `src/theme/colors.js` | pode parecer segunda paleta se usado como owner |
| Tipografia | fonte do sistema; 7 papéis no theme; muitos tamanhos locais | theme + styles locais | `expo-font` instalado sem família carregada; escala parcialmente divergente |
| Kit UI | 9 componentes compartilhados, usados por várias superfícies | `src/components/ui/` | cobertura incremental; telas legadas ainda implementam variantes próprias |
| Buttons/cards/chips | primary/secondary/ghost/cyan/danger, cards tonais, pills frequentes | kit UI + telas | vários estilos paralelos e glows; não migrar em massa |
| Estados | empty/loading/error/offline/permission/retry consolidados | `src/components/states/` | Pressables internos ainda têm semântica incompleta |
| Navegação | drawer + native stacks, dark headers, menu acessível | `src/navigation/MainNavigator.js` | headers e stacks não usam uma única composição visual |
| Mapa | MapLibre full-surface, rota/territórios data-driven, overlays e docks | `MapScreen` + `WayperMapLibre` | muitos overlays; mapa e tracking competem; raw map colors |
| Corrida ativa | painel superior, tempo/distância, status/GPS, pause/resume/finalize | `src/screens/MapScreen.js` | map-first, pace ausente; direction aprovada pede foco/mapa opcional |
| Pós-corrida | sheet editável com métricas, território/XP parcial, esforço, tags, notas e foto | `src/components/RunSummaryModal.js` | não compõe ainda ranking/missões/rewards/medalhas em módulos |
| Ranking | período/escopo/modos, leader/my-rank/list, estados cache/local/empty | `src/screens/RankingScreen.js` | superfície OPERATE densa; coerência precisa de slice visual futuro |
| Progressão | XP/nível/ranking distribuídos entre dashboard/perfil/relatório | services + screens | linguagem visual não está centralizada |
| Medalhas | 9 defaults, avaliação/persistência local, announcement, pulse/glow | `src/components/MedalsWidget.js` | emojis remotos e expressão própria; não é design system global |
| Missões/rewards | conceitos em produto/progressão | sem screen dedicada atual | `not_applicable` à auditoria de implementação; não inventar UI |
| Motion | Animated/Moti/Reanimated/Skia já instalados; press, fade, spring, pulse, route fade | componentes/telas | sem owner de reduced motion; motion decorativa reaparece |
| Assets | logo atual lime/verde/cyan; screenshots escuros teal e login claro antigos | `assets/` | screenshots divergem do theme atual e não são spec |

Inventário mecânico da baseline:

- 48 arquivos de screen/component referenciam `WayperTheme`;
- 17 ainda contêm literal hex;
- 47 ocorrências de `<Pressable>` contra 12 `accessibilityRole` e 2
  `accessibilityLabel` na amostra global;
- não foi encontrado `useReducedMotion`, listener para reduce motion, custom
  `fontFamily` ou `allowFontScaling={false}`;
- alvos entre 30 e 42 dp aparecem no source. Alguns têm `hitSlop` ou podem não
  ser interativos; cada caso precisa de verificação antes de virar bug.

## Ownership resolvido

| Camada | Owner | Não possui |
| --- | --- | --- |
| Product Truth | `docs/product/`, decisões e regras aprovadas | valores visuais locais |
| Design Contract | `DESIGN.md` | comportamento funcional ou token executável |
| Runtime Tokens | `src/theme/wayperTheme.js` | estratégia de produto ou implementação de tela |
| Compatibility aliases | `src/theme/colors.js` | nova source of truth |
| Component implementation | `src/components/ui/`, states, screen/component owner | autoridade para redefinir o contrato por drift |
| Android semantics | OS + Expo/RN/navigation/native config | identidade visual da Wayper |
| Evidência histórica | `docs/09-design-e-wireframes.md`, screenshots, esta auditoria | norma visual vigente |

`DESIGN.md` possui ROI porque o runtime já contém um sistema coerente, mas ele
estava espalhado e o documento anterior declarava paleta/tipografia/componentes
como pendentes. O contrato reduz redescoberta e conflito. Ele deliberadamente
não usa frontmatter machine-readable do Impeccable: nessa estrutura, tokens
seriam normativos e duplicariam `WayperTheme`.

## Android/native correctness

Estado confirmado:

- Expo e manifest fixam portrait; iOS declara `supportsTablet: false`;
- `userInterfaceStyle: dark` e splash/adaptive icon escuros;
- `react-native-safe-area-context` é usado por `WPScreen` e algumas telas;
- modais observados fornecem `onRequestClose`; `WPBottomSheet` permite backdrop;
- inputs/chat usam `KeyboardAvoidingView` em alguns fluxos;
- Android usa `windowSoftInputMode="adjustPan"`;
- `android:enableOnBackInvokedCallback="false"` desativa Predictive Back;
- não há routing por window size, foldable posture ou landscape;
- não há política central de reduced motion.

Consequência: phone/portrait/dark é contrato de entrega atual. Predictive Back,
IME, font scale, 48 dp, TalkBack, tablets, multi-window, foldables e reduced
motion são gaps de conformance/adaptivity para safe slices futuros. Não foram
alterados nesta unidade para evitar mudança funcional e risco de corrida.

## Impeccable real e atual

### Provenance

- nenhuma instalação local foi encontrada no projeto, PATH, skills globais ou
  caches comuns;
- catálogo remoto observado: release `3.9.1`, unlisted global, Renaissance Geek
  Inc.;
- npm `latest` observado: `3.6.0`;
- upstream auditado: `pbakaus/impeccable`, tag `skill-v4.1.1`, commit
  `5a149f3fdb1b5793f10567233b1dcab98fc305fd`, 2026-08-14;
- a divergência de canais impede tratar catálogo/npm como versão corrente única.

O upstream foi clonado em diretório temporário somente para leitura, sem copiar
arquivos, instalar pacote, executar detector ou persistir config.

### Estrutura auditada

- `SKILL.md` 4.1.1 com progressive setup, modos e 23 commands;
- `document`, `extract`, `shape`, `critique`, `polish`, `harden`, `animate`;
- `audit.native`, `adapt.native`, `android`, `operate`, `craft-floor`;
- manifests de hooks para Codex/Claude/Cursor/Copilot;
- registry de anti-patterns, detector regex/DOM/browser e design-system checks;
- scripts de context, hook administration, critique snapshots e Codex install;
- agents de build/finish/document/assets no upstream.

### Adopted

- visual authority vem de evidência, não do nome `DESIGN.md`;
- refinement preserva identidade e escopo;
- OPERATE prioriza tarefa/scanabilidade; motion de rotina é rápida e sem
  coreografia;
- EXPERIENCE pode reservar uma sequência focal;
- native audit separa accessibility, performance, theming, platform conformance
  e adaptivity, exige impacto/evidência e inclui achados positivos;
- adaptação reestrutura por window size, não estica nem detecta modelo;
- polish corrige causa no menor owner e cobre estados/edge cases;
- hardening inclui long copy, offline, permission, erro, i18n e double action;
- motion deve explicar state/relationship/reward e ter reduced-motion path;
- `document` começa pelo sistema incumbente e não inventa token ausente.

### Adapted to Wayper

- modos upstream `Operate`/`Experience` viraram janelas explícitas da Wayper:
  quase todo app opera; pós-corrida/conquista celebra brevemente;
- o mínimo Android upstream de 48 dp substitui o genérico 44 pt onde o target é
  Android;
- a recomendação Material/Dynamic Color não substitui o dark brand atual; o OS
  mantém semântica e a Wayper mantém paleta;
- o DESIGN.md upstream tornaria frontmatter tokens normativos. Aqui o markdown
  é contrato e aponta para o theme runtime como owner dos valores;
- craft-floor contra glow/gradient/card foi convertido em regra de parcimônia,
  não ban: verde luminoso, mapa e logo já são identidade incumbente;
- audit source-first foi usado, mas score/claims de device ficaram ausentes sem
  prova física.

### Rejected / not applicable

- detector web/DOM/CSS, browser overlay e `live`: não analisam corretamente
  `StyleSheet`, Pressable, TalkBack, MapLibre ou React Native runtime;
- instalação/copiar a skill: custo e manutenção sem uso repetido provado;
- sidecar `.impeccable/design.json`: duplicaria tokens e contém snippets HTML/CSS;
- custom fonts/distinct display face: não existem no produto atual;
- web-specific hover, scrollbar, caret, CSS breakpoints, `prefers-reduced-motion`,
  rem/ch e browser screenshots;
- agents/processos upstream: não foram necessários e multi-agent do projeto é
  opt-in;
- extração/migração automática de components: abstração prematura nesta unidade;
- bans universais contra cyan-on-dark, glow e system font: contradizem evidência
  e contexto OPERATE/mobile da Wayper.

## Hook decision

**Decisão: não instalar hook do Impeccable.**

O projeto já possui `.codex/hooks.json` com um único Stop backstop. A integração
4.1.1 adicionaria PostToolUse e outro Stop; hooks de múltiplas fontes coexistem e
matching command hooks executam concorrentemente no Codex. Resultado provável:
dupla execução no encerramento, overhead permanente e detector inadequado para
RN. O native audit do Impeccable é guidance de leitura, não detector executável.

Nenhum manifest, `.impeccable/`, dependência, config ou hook foi criado.

## Capability e skill ROI

Onze capabilities de design passam a apontar para uma única reference
on-demand: `DESIGN.md`. Nenhuma nova skill foi criada.

```text
OBSERVED_REUSE (baseline inicial, ainda zero)
+ FAILURE_PREVENTION (contrato ajuda, mas reference cobre)
+ REDISCOVERY_COST (moderado)
< PERMANENT_DISCOVERY_COST + MAINTENANCE + OVERLAP
```

Reavaliar skill somente após tarefas reais mostrarem workflow Wayper-specific
repetido que o contrato não cobre. `CAPABILITY_ONLY` continua decisão válida
para candidate que não justifique asset/entry; os candidatos desta baseline têm
reference comum porque todos dependem do mesmo contrato.

## Safe slices futuros, sem autorização implícita

| Prioridade | Slice | Evidência / objetivo | Validação necessária |
| --- | --- | --- | --- |
| P1 | reduced motion owner | pulses/entrances sem preferência central | testes + emulator/device com Remove animations |
| P1 | accessibility de shared UI/states | roles/labels/targets incompletos em owners reutilizados | TalkBack, font scale 1.3, touch targets |
| P1 | Predictive Back + IME contract | callback desativado e `adjustPan` global | navigation/modal/form regressions em Android |
| P1 | active-run focus composition | direction aprovada diverge do map-first/sem pace | device físico durante corrida; zero risco ao tracking |
| P2 | semantic token aliases | 17 arquivos com raw hex e papéis ausentes | screenshots dark + contrast; migração incremental |
| P2 | motion cleanup OPERATE | pulses/glows/entrances distribuídos | frame/runtime + reduced motion |
| P2 | post-run module shell | summary atual não compõe states/módulos | save local nunca bloqueado; fixtures por módulo |
| P2 | medal identity | emoji remoto/glow próprio | offline, assets locais, announcement |
| P2 | map overlay hierarchy | topo/bottom/banners/sheets competem | gestures/insets/one-hand/device |
| P3 | navigation/header convergence | stacks e headers paralelos | Back, deep link, drawers e safe areas |
| P3 | tablet/window-size discovery | sem suporte atual | decisão de produto antes de implementação |

Não promover componente/token durante esses slices até confirmar repetição e
intenção iguais. O rollback desta unidade é apenas reverter docs, registry,
evals e validator; nenhum runtime do produto foi tocado.
