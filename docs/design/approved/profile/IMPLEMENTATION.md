# Parte 4 — contrato e auditoria do perfil

## Auditoria antes da implementação

Branch `develop`; WIP da Parte 3 preservado. Baseline e hashes locais em
`.wayper-context/part4-profile/initial-hashes.json`. Nenhum commit/push autorizado.

| Entrada anterior | Fonte e comportamento | Reuso / migração |
| --- | --- | --- |
| `screens/ProfileScreen.js` | `loadCurrentProfile` e subscription; estatísticas locais de `profileStats`, progressão e catálogo de conquistas; edição/avatar, privacidade, sync e PNG | Preservada como gestão temporária; novo perfil lê os mesmos owners |
| `ranking/PlayerProfileScreen.js` | `getPublicProfile`; agregados públicos, snapshot próprio e fixtures DEV | Ranking passa ao componente canônico; legado conservado até equivalência comprovada |
| `Friends/FriendProfileScreen.js` | documento users, subcoleção runs, histórico e MedalsWidget | Entrada passa ao canônico; legado/histórico disponíveis durante transição |
| MainTabs Perfil | rota Drawer `Perfil` | Mantém nome e barra Home, Mapa, Correr, Ranking, Perfil |
| Groups | `GroupDetailScreen.openMember`: próprio → Perfil, outro → Amigos/FriendProfile | Migra pela mesma rota adaptada sem alterar Groups |
| Home / território | Home abre lista Amigos e detalhes de atividade; mapa aceita `focusUserId` em `useMapTerritories` | Fluxos mantidos; aba Território usa foco existente |

`runRepository` é a fonte local de histórico; `territoryRepository` e
`territoryStorageService` possuem dados territoriais. `territoryPrivacyService`
define visibilidade public/followers/private e vínculo de amizade; esse nome
legado **não** estabelece um domínio de seguidores. `achievementRepository`
possui catálogo/progresso por usuário local; não há contrato público equivalente.
Não foi localizado domínio real de liga, followers/following ou ranking territorial
individual. Campos ausentes devem permanecer indisponíveis, sem fixtures.

Deep link anterior: `wayper://run/active`, scheme `wayper` registrado em PROD e
`wayper-dev` no flavor DEV.
Não existe contrato confirmado de URL web pública para perfil.

## Contrato canônico antes da UI

`ProfileScreen({ route, navigation })`, com `route.params.userId` explícito;
aliases `playerId`/`friendId` somente para compatibilidade. Ausência de parâmetro
resolve o usuário autenticado; parâmetro inválido não resolve silenciosamente self.
Identidade normalizada: `{ userId, own, invalid }`.

Modelo de apresentação allowlisted: identidade (nome, username explícito,
avatar, cidade, bio), privacidade, nível/XP, métricas, recordes e disponibilidade.
Sem e-mail, telefone, endereço ou metadata técnica. Valores desconhecidos são
`null`, exibidos como `—`. Followers/following ficam `null` até domínio real.
Perfil privado público não permite carregar atividades, território ou conquistas.
Mudança de userId descarta resultados pendentes do usuário anterior.
O perfil público mantém a assinatura Firestore de privacidade da tela anterior;
restrição, remoção ou erro do documento retira detalhes e compartilhamento abertos.
Blur e mudança de usuário encerram a assinatura e ignoram respostas obsoletas.

Perfil próprio: estatísticas do `loadCurrentProfile`, histórico e território
locais existentes, catálogo completo de conquistas. Perfil público futuro: documento
remoto, corridas permitidas pelo contrato de visibilidade e território do owner;
sem leitura de conquistas locais como se fossem públicas. Geometria de rota
pública não sai do adapter; detalhe reutiliza RunDetail em modo somente leitura.

## Escopo, validação e rollback

Consolidar apresentação em `screens/profile/`, registrar navegação e deep link,
reutilizar captura PNG/save/share existentes. Sem escrita em runs/storage v3,
tracking, Active Run ou wayper-site. Rollback remove as novas entradas e restaura
somente os trechos desta Parte 4; preserva WIP e dados locais.

Validação exigida: testes direcionados, suíte src, arquitetura/tamanho/contexto,
benchmark, quality gate, whitespace, build DEV, backstop, comparação de screenshots
e fluxo físico exclusivamente `com.wayper.app.dev`. Conclusão depende de prova
material, não desta descrição.

## Dependências futuras

- Followers/following e ações Seguir exigem contrato social próprio; amizade bilateral permanece amizade.
- Privacidade e informações técnicas: destino **Configurações > Privacidade** / Diagnóstico. Acesso de gestão legado temporário preserva lógica sem reformular Settings.
- Compartilhamento usa deep link interno `wayper://profile/<userId>` quando implementado; universal/app links web exigem domínio, associação e destino web futuros.
- Liga, ranking territorial e conquistas públicas dependem de dados/contratos reais; nenhuma classificação será inventada.

## Implementação e limites observados

Componente canônico: `src/screens/profile/ProfileScreen.js`. `ProfileStack` é
usado por Perfil, Ranking/PlayerProfile e Amigos/FriendProfile. As duas telas
públicas antigas permanecem no source. O próprio perfil legado permanece acessível
em `Gerenciar perfil`; `Editar perfil` abre seu formulário existente. Nenhuma
regra de escrita, avatar, privacidade ou sync foi substituída.

`userProfileRepository` continua sendo o owner Firestore; acrescenta consultas
de amizade bilateral e páginas de 12 corridas. `profileScreenAdapter` apenas
compõe os owners existentes, filtra visibilidade e projeta campos públicos.
Paginação pública mantém cursor mesmo quando uma página inteira está oculta.
Atividade territorial própria lê `territoryRepository.listEvents`; os eventos
permanecem no mesmo domínio e seguem o filtro de owner já existente.
Rotas públicas são removidas da projeção antes de chegar ao detalhe; somente
agregados permitidos são transmitidos ao RunDetail em modo somente leitura.

PNG reutiliza ViewShot, `saveTempImageAsync`, `sharePngFile` e
`savePngToGallery`. O fluxo oferece clipboard e share sheet de links internos,
com scheme DEV `wayper-dev` e PROD `wayper`. A capa gerada é um recurso
decorativo genérico, não identidade, localização real ou dado de atleta.
Nenhuma imagem de mockup é usada como tela ou dado.

O novo caminho público de deep link exige uma única adaptação do seletor visual
da MainTabs: `PublicProfile` seleciona Perfil; sua lista, ação Correr e estado do
Mapa são preservados. Ranking mantém sua instância e seleção no stack pai.

Na validação inicial em 2026-10-14, leitura REST autenticada executada no próprio
Samsung retornou HTTP 404: o database `(default)` não existe no projeto configurado
`wayper-3ee61`. Não foi criado banco nem alterada configuração Firebase.
Essa observação histórica não define o contrato CURRENT de aceitação.
O amendment de 2026-10-16 abaixo substitui a exigência de backend/observador
remoto pela prova da fonte CURRENT, sem converter preview em usuário real. Evidências e relatório por requisito
ficam em `.wayper-context/part4-profile/`.

O catálogo L2 do Validation Planner inclui o teste de integração do adapter de
perfil: usa normalização e política de privacidade reais, com I/O dos repositories
controlado. Essa prova é de integração local; não substitui Firestore ou Android.

## Amendment CURRENT — 2026-10-16

A integração online de users/social/ranking ainda não constitui backend
multiusuário utilizável do CURRENT. Há callers Firestore no código, conservados
para integração futura; sua existência não prova serviço online disponível.
Nenhuma prova remota foi realizada neste amendment e nenhuma garantia server-side
é alegada. Não criar Firebase/database/usuário, habilitar billing ou tocar PROD.

O Ranking usa o repository existente (tentativa remota, cache e fallback próprio)
e oferece rankingPreviewData apenas em DEV quando a lista está vazia. O antigo
PlayerProfile usa playerProfilePreviewData. O adapter canônico agora reutiliza
essa mesma fonte exclusivamente quando DEV e preview=true são explícitos.
Nenhuma identidade ou métrica foi acrescentada aos fixtures existentes.
Prévia mostra o rótulo DEV, nunca vira perfil próprio e não compartilha um link
público inexistente. Abas sem registros ficam vazias; não leem dados do titular
nem Firestore. Followers/following seguem null/—. Amigos mantém o contrato
bilateral existente, seus callers remotos e cache, sem observador remoto provado.

Os cinco requisitos pendentes passam a exigir: (1) próprio e outro userId da
fonte CURRENT no mesmo componente; (2) Ranking -> outro userId -> Back com estado
preservado; (3) Público -> Privado -> Público persistido localmente e aplicado
pelo modelo/repository/UI, inclusive atividades/share; (4) comparação visual
própria já admitida e pública CURRENT; (5) execução física pública CURRENT usando
identidade DEV preview claramente classificada. Mantêm-se os requisitos de
ações próprias ausentes, campos allowlisted, território real vazio válido e
dados sociais ausentes não fabricados. Backend não é condição de aceitação.

Quando sync social/Firebase for implementado, revalidar privacidade server-side
entre duas contas reais. A futura fase deve validar duas contas reais, Profile
público remoto, followers/following, Ranking remoto, leitura de atividades,
acesso a território público e deep links públicos. Esta dívida é obrigatória
naquela fase e não bloqueia a Parte 4 CURRENT.
