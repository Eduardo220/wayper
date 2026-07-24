# Design e Wireframes

## Objetivo visual

O Wayper deve parecer uma plataforma esportiva, competitiva e moderna. Durante a
atividade, o foco visual é calma, legibilidade e segurança; depois dela, descoberta
e sensação de conquista.

## Telas principais

| Tela | Objetivo |
| --- | --- |
| Login | Entrar no app. |
| Cadastro | Criar conta. |
| Home/Menu | Ser a entrada social do app, com stories, amigos recentes, feed de atividades e acoes rapidas discretas. |
| Corrida | Iniciar, acompanhar e finalizar corrida. |
| Mapa | Visualizar localizacao e zonas. |
| Relatório da Expedição | Revelar métricas, trajeto, territórios, progressão e resultados parciais. |
| Ranking | Comparar progresso com outros usuarios. |
| Perfil | Ver dados, estatisticas e conquistas. |
| Dashboard | Ver estatisticas pessoais, XP, territorio, ranking e sync. |
| Amigos | Gerenciar conexoes sociais. |
| Grupo | Competicao entre grupos/amigos. |
| Onboarding | Explicar proposta, offline/local-first e permissoes sem pedir cedo demais. |
| Diagnostico | Exportar evidencias locais e resumos tecnicos com privacidade. |

## Componentes importantes

- Botao de iniciar corrida.
- Indicador de corrida ativa.
- Stories horizontais de corrida no topo da Home.
- Card/lista de feed social com corridas livres, corridas por zonas, conquistas e atividades reais/cacheadas.
- Atalho compacto para iniciar/continuar corrida.
- Acao compacta "Adicionar ao story" com seletor de corridas finalizadas.
- Dashboard pessoal em `Dashboard`/`Perfil`, nao como conteudo principal da Home.
- Cards de estatisticas pessoais apenas fora da Home social.
- Card discreto de sync pendente/falho quando aplicavel.
- Lista de ranking.
- Mapa com poligonos de zonas.
- Linha de rota.
- Painel ativo mínimo com tempo, distância, pace, estado, GPS crítico e controles.
- Relatório modular da Expedição, evoluindo o resumo atual.
- Alertas de permissao/localizacao.
- Central de diagnostico em Configuracoes.

## Modal de compartilhamento de corrida

`RunShareModal` deve manter o padrao visual escuro/verde da Wayper e separar claramente dois produtos diferentes:

- `Imagem`: card completo com mapa/preview de rota, identidade Wayper, distancia, tempo, pace, data, modo livre/zonas e area conquistada quando houver dado real.
- `Tracado PNG`: preview em fundo quadriculado/transparente; o arquivo exportado deve conter apenas o tracado/rota ou o poligono real de zona, sem card e sem fundo.

Cada opcao carrega suas acoes dentro do proprio bloco:

- Imagem: `Compartilhar`, `Baixar imagem`, `Adicionar ao story`.
- Tracado PNG: `Compartilhar PNG`, `Baixar PNG`, `Adicionar ao story`.

Nao criar botoes soltos duplicados fora das opcoes. `Copiar` nao deve aparecer enquanto o build/plataforma nao oferecer clipboard de imagem confiavel.

Estados esperados:

- Rota insuficiente: manter preview/fallback e desabilitar acoes do `Tracado PNG`.
- Download em andamento: botao com loading e sem disparar segunda acao.
- Permissao de midia negada: alerta com orientacao e caminho para configuracoes quando aplicavel.
- Story duplicado: informar sem criar novo registro.

## Diretrizes de UX

- Acao principal deve estar visivel.
- Na Home, a acao principal deve ser compacta: continuar corrida preservada ou abrir o mapa para iniciar uma nova.
- Home deve priorizar stories/feed social; estatisticas pessoais ficam em Perfil/Dashboard.
- Tela de corrida nao pode ser confusa.
- Modo foco é a experiência ativa padrão; mapa deve ser opcional.
- Durante corrida não há promoção, anúncio, parceiro, recompensa, missão ou
  upgrade.
- Controles de pausa/finalização mantêm área de toque segura e proteção contra
  toque acidental.
- Feedback de GPS deve ser claro.
- Nao esconder erro tecnico atras de mensagem generica inutil.
- Ranking deve mostrar posicao do usuario.
- Mapa deve diferenciar area propria e area de outros usuarios.
- Home nao deve mostrar mock/demo como story, amigo, online, feed, progresso, ranking ou territorio real.
- Bolinha/status online so aparece com presenca real/cacheada.
- Sem avatar, usar placeholder local com iniciais em vez de imagem remota generica.

## Estados obrigatorios

Toda tela relevante deve prever:

- Carregando.
- Vazio.
- Erro.
- Sem internet, se aplicavel.
- Sem permissao de localizacao.
- Dados incompletos.
- Na Home: sem stories, sem amigos, sem feed, offline/cache, usuario novo, sem corridas para postar e story local pendente de sync.
- Em Diagnostico: sem logs, export em andamento, export concluido, falha parcial de secao, dados mascarados por privacidade.
- Em Onboarding/permissoes: educacao antes do pedido, permissao bloqueada com acao de configuracoes e permissao opcional negada como limitacao.
- No Relatório da Expedição: `pending`, `processing`, `ready`,
  `failed_retryable`, `failed_permanent` e `not_applicable` por módulo, sem
  bloquear o conjunto.

Padrao visual:

- Usar `src/components/states` para `EmptyState`, `ErrorState`, `OfflineState`, `PermissionState`, `LoadingState` e `RetryState` sempre que a tela nao tiver um componente mais especifico ja consolidado.
- Copy deve ter titulo curto, explicacao simples e acao clara.
- Permissoes opcionais negadas devem parecer limitacao controlada, nao erro fatal.
- Placeholder de avatar deve ser local por iniciais/icone; nao usar URL generica ou mock remoto como avatar real.
- Estados offline devem dizer que dados locais/cacheados estao sendo usados quando isso for verdade.

## Assets atuais

O README referencia imagens em:

```txt
assets/screens/login.png
assets/screens/corrida.png
assets/screens/menu.png
assets/screens/perfil.png
assets/screens/ranking.png
assets/screens/amigos.png
assets/screens/group.png
```

## Pendencias

- Definir paleta oficial.
- Definir tipografia.
- Definir componentes base.
- Definir estados visuais das zonas.
- Criar wireframes atualizados para telas futuras.
- Criar wireframes do modo foco e do Relatório da Expedição antes da implementação.
