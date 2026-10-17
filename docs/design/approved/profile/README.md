# Perfil Wayper — Referências Visuais Aprovadas

Este diretório contém as referências visuais canônicas da reformulação do perfil da Wayper.

As referências 01 a 06 abaixo definem a direção visual, hierarquia de informação, organização das seções e comportamento esperado da Parte 4 do redesign.

Elas não representam dados literais nem exigem cópia pixel-perfect de valores, nomes, imagens ou métricas fictícias.

O objetivo é preservar a estrutura, a identidade visual e a experiência aprovadas.

---

## Referências

### 07 — Gerenciar perfil

`07-profile-edit.png` é a referência aprovada para Gerenciar perfil. A edição
possui contrato próprio em [EDIT-IMPLEMENTATION.md](EDIT-IMPLEMENTATION.md),
posterior ao encerramento da Parte 4. O formulário mantém o username imutável
e contém somente dados editáveis e nível/XP compacto.

SHA-256 da versão aprovada em 2026-10-15:
`6d53a03f28c48cfa237eed8433b835a7677c1e670f7acf03ad30fb530722c3ce`.

### 01 — Perfil próprio

Arquivo:

`01-profile-own-overview.png`

Representa o perfil do usuário autenticado.

Elementos principais:

- foto de perfil;
- nível sobreposto à foto;
- nome;
- `@username`;
- cidade;
- bio;
- liga atual;
- métricas principais;
- seguidores;
- seguindo;
- botão `Editar perfil`;
- botão `Compartilhar`;
- abas:
  - Corridas;
  - Território;
  - Conquistas;
- navegação inferior da Wayper.

Esta é a principal referência estrutural do `ProfileScreen` quando o usuário visualiza o próprio perfil.

---

### 02 — Perfil público

Arquivo:

`02-profile-public-overview.png`

Representa o perfil de outro usuário.

Deve reutilizar a mesma estrutura visual do perfil próprio.

Principais diferenças:

- não exibe `Editar perfil`;
- exibe ação social como `Seguir` ou `Seguindo`;
- pode exibir menu adicional de ações;
- mantém seguidores e seguindo;
- mantém as mesmas abas:
  - Corridas;
  - Território;
  - Conquistas.

O perfil público não deve existir como uma tela visualmente independente do perfil próprio.

A arquitetura desejada é um perfil canônico compartilhado, equivalente conceitualmente a:

`ProfileScreen(userId)`

---

### 03 — Aba Corridas

Arquivo:

`03-profile-runs-tab.png`

Define a apresentação das atividades recentes do usuário.

Cada corrida pode apresentar:

- miniatura do mapa;
- trajeto;
- nome da atividade;
- data ou tempo relativo;
- localização aproximada;
- distância;
- duração;
- pace;
- zonas conquistadas;
- XP;
- interações sociais quando disponíveis;
- acesso ao detalhe da corrida.

A lista deve manter a linguagem visual do restante do perfil.

Dados privados ou localização sensível não devem ser expostos apenas para reproduzir o mockup.

---

### 04 — Aba Território

Arquivo:

`04-profile-territory-tab.png`

Define a visualização territorial dentro do perfil.

Pode conter:

- mapa territorial;
- zonas conquistadas;
- área dominada;
- atividade territorial recente;
- ranking territorial;
- últimas zonas conquistadas;
- acesso ao mapa completo.

Esta aba deve reutilizar os dados e serviços territoriais existentes sempre que possível.

Não deve criar uma segunda fonte de verdade para território.

---

### 05 — Aba Conquistas

Arquivo:

`05-profile-achievements-tab.png`

Define a organização de:

- recordes pessoais;
- conquistas;
- progresso de conquistas;
- conquistas concluídas;
- conquistas ainda bloqueadas.

Os Recordes existentes na implementação atual devem ser preservados.

Exemplos:

- maior corrida;
- melhor pace;
- pace médio;
- tempo total;
- outros recordes relevantes já suportados pelos dados reais.

As Conquistas existentes também devem ser preservadas e reorganizadas visualmente conforme esta referência.

Não remover funcionalidades existentes apenas para simplificar o layout.

---

### 06 — Compartilhar perfil

Arquivo:

`06-profile-share-flow.png`

Define o fluxo iniciado pelo botão `Compartilhar`.

O compartilhamento do perfil deve oferecer dois formatos principais:

#### Imagem do perfil

Gerar uma imagem compartilhável semelhante aos cards já utilizados pela Wayper.

A imagem pode conter:

- foto;
- nome;
- username;
- cidade;
- nível;
- liga;
- bio;
- principais estatísticas.

O usuário deve poder:

- salvar a imagem no dispositivo;
- compartilhar a imagem através do share sheet do sistema.

#### Link do perfil

O usuário também deve poder:

- copiar o link público do perfil;
- compartilhar o link através do share sheet.

O cartão compartilhável não deve permanecer como uma seção fixa dentro do perfil.

Ele passa a fazer parte do fluxo de `Compartilhar`.

---

# Decisões de Produto

## Privacidade

A seção de Privacidade atualmente existente no perfil não fará parte da nova tela principal.

Essas configurações devem ser preservadas e futuramente movidas para:

`Configurações > Privacidade`

Nenhuma funcionalidade de privacidade deve ser removida durante a reformulação.

Até a nova tela de Configurações ser implementada, preservar o comportamento existente de forma segura.

---

## Sincronização e informações técnicas

Informações como:

- fonte dos dados;
- última sincronização;
- pendências de sync;
- falhas de sincronização;
- informações técnicas de diagnóstico;

não pertencem ao perfil social principal.

Esses dados devem futuramente ficar em Configurações ou Diagnóstico.

Não remover a lógica existente sem uma migração explícita.

---

## Métricas

O perfil antigo contém blocos específicos para:

- distância;
- corridas;
- zonas;
- área.

A nova interface não precisa preservar esses cards exatamente na mesma posição ou formato.

Informações relevantes podem ser distribuídas entre:

- header do perfil;
- Ranking;
- aba Território;
- Recordes;
- Conquistas.

Evitar duplicar a mesma informação em várias áreas sem necessidade.

---

## Recordes

Recordes devem continuar existindo.

Eles podem ser apresentados dentro da aba `Conquistas` ou em uma seção associada a ela.

A localização visual pode mudar, mas a funcionalidade não deve desaparecer.

---

## Conquistas

Conquistas permanecem como parte importante do perfil.

Devem apresentar claramente:

- título;
- descrição;
- progresso;
- objetivo;
- estado concluído ou bloqueado.

---

## Seguidores e Seguindo

O design aprovado utiliza:

- seguidores;
- seguindo;
- Seguir;
- Seguindo.

Entretanto, a implementação atual da Wayper possui um modelo de amizade bilateral.

Não assumir que `Amigos` e `Seguidores` representam o mesmo domínio.

A implementação social definitiva deve ser tratada separadamente.

Até existir um contrato de followers/following real, não criar dados fictícios ou converter silenciosamente amizades existentes em seguidores.

---

# Arquitetura desejada

A direção desejada é abandonar gradualmente telas de perfil duplicadas como:

- perfil próprio;
- perfil vindo do Ranking;
- perfil de amigo.

O destino arquitetural é um perfil canônico:

`ProfileScreen(userId)`

Com comportamento baseado no usuário exibido.

Exemplo conceitual:

```text
ProfileScreen(currentUserId)
→ perfil próprio
→ Editar perfil
→ Compartilhar

ProfileScreen(otherUserId)
→ perfil público
→ Seguir / Seguindo
→ ações públicas
