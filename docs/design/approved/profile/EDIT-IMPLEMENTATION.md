# Gerenciar perfil — contrato CURRENT

A referência `07-profile-edit.png` é a direção aprovada da edição. A tela usa
os tokens de WayperTheme, capa e avatar do Profile, ProfileButton e WPBottomSheet
existentes. Não altera a composição do Profile principal nem MainTabs.

## Estrutura e campos

Capa atual e ação Alterar capa (amendment solicitado em 2026-10-17); avatar e ação
Alterar foto; nome de exibição; username bloqueado; cidade; bio; ação Visibilidade
do perfil; nível/XP compacto; Salvar alterações e Cancelar. Nome e cidade têm
limite 50, bio 160 conforme referência aprovada; nome não pode ficar vazio.
Bio mantém quebras de linha e contador. Username ausente permanece —, sem
fabricar identidade a partir de e-mail. Nenhum dado de exemplo da referência
preenche o formulário.

Capa e foto oferecem câmera e galeria com permissões e cancelamento nativos. Remoção de
foto não é oferecida porque não havia suporte real para essa ação. O picker muda
somente o rascunho. A capa usa recorte 16:9 e a foto 1:1. Ao salvar, as imagens são copiadas do cache
para documents/covers ou documents/avatars;
a tentativa de upload existente continua posterior e não bloqueia o save local.

## Salvamento e cancelamento

A tela compara o rascunho aos valores carregados e envia apenas campos editados:
name, city, bio, avatarLocalUri, coverLocalUri e o par isPrivate/profileVisibility. Não envia
username, XP, nível, ranking, corridas, território ou conquistas. O repository
valida os limites, filtra os campos e usa merge remoto explícito. O owner local
existente grava duravelmente antes de resolver a mutation; a opção localOnly
não executa progressão nem publica métricas. Edições e flushes de progresso
compartilham a fila de escrita local do mesmo owner; cada flush captura o
estado após a edição anterior, evitando restaurar identidade antiga. Falha local mantém o rascunho e
permite retry. Tentativa remota é best effort, sem garantia de sync futuro.

Cancelar e Back descartam o rascunho. Salvar volta ao Profile, que recarrega pelo
focus existente. Campos de identidade locais já persistidos têm precedência
sobre documento remoto antigo; não existe store ou cache paralelo. O mesmo campo cover é projetado no Profile
canônico e no seu fluxo de compartilhar; imagem ausente/inválida mantém a capa
Wayper padrão. Cancelar não persiste capa nem foto. Schema e
chave do perfil local e storage de corridas não são migrados.

## Username

Criação inicial permanece em createUserIfNotExists, usado no cadastro/login.
Sanitização, geração obrigatória e consulta de usernames legados são preservadas.
A criação de usuário e reserva usernames/{username} acontece numa única transação;
colisões recebem outro candidato com tentativas limitadas e falham fechadas sem
perfil sem reserva. Reentrada do mesmo UID conserva o username existente.
Nenhuma migração, normalização retroativa ou renomeação de contas existentes.

updateUser e updateCurrentUserProfile rejeitam username e caminhos username.*
antes da escrita. saveProfile rejeita mudanças diretas e permite somente o mesmo
valor em merges internos legados. Username não pertence à mutation do editor.
Os testes de concorrência simulam o contrato transacional; não constituem prova
remota de regras Firestore. Quando social online for implementado, implantar e
validar autorização da reserva e imutabilidade server-side, incluindo todos os
writers antigos. Nenhum recurso Firebase foi provisionado nesta entrega.

## Visibilidade CURRENT

O seletor Público/Privado altera somente o rascunho. Salvar persiste exatamente
o par isPrivate/profileVisibility do contrato existente; Cancelar não muda o
perfil. Modelo e adapter canônicos continuam restringindo os detalhes, atividades
e share para observadores de perfil privado e restaurando o comportamento
público. A capa personalizada também usa a mesma restrição para observadores;
o titular continua vendo sua capa. O próprio titular mantém acesso aos seus dados e ações existentes.
Não se alega privacidade server-side nem observação entre duas contas remotas.
Essa validação pertence à futura fase Firebase/social já documentada na Parte 4.

## Destino do conteúdo removido da edição

| Conteúdo | Destino |
| --- | --- |
| Recordes | Profile / Conquistas |
| Conquistas | Profile / aba Conquistas |
| Compartilhar e PNG | botão Compartilhar do Profile |
| Ranking | tela Ranking |
| Métricas | Profile / Ranking / Território |
| Privacidade avançada | futura Configurações > Privacidade |
| Sync e diagnóstico | futura Configurações / Diagnóstico |

Foram removidas as seções da tela de edição. Seus owners e consumidores externos
permanecem. Configurações completa, followers e integração social online não
fazem parte deste escopo.
