# Arquitetura técnica

## Stack provável

A Wayper é um app mobile em React Native com Expo.

Componentes principais:

- React Native para interface mobile.
- Expo para desenvolvimento, permissões e APIs nativas.
- Firebase Authentication para login.
- Firestore para persistência.
- `expo-location` para localização.
- Biblioteca de mapas para renderização do mapa e rotas.
- Turf.js ou biblioteca geográfica semelhante para cálculos de distância, linhas, polígonos, buffers ou interseções.

## Princípios técnicos

- Separar regra de negócio de componentes visuais.
- Não acoplar Firestore diretamente às telas quando houver lógica reutilizável.
- Tratar GPS como domínio próprio.
- Centralizar cálculos de território em services ou módulos específicos.
- Manter MVP simples e testável manualmente.
- Documentar qualquer mudança relevante antes de ampliar a mecânica.

## Separação sugerida

### `screens`

Responsável por telas completas:

- Mapa.
- Atividade ativa.
- Resumo.
- Perfil.
- Histórico.
- Login e cadastro.

### `components`

Responsável por peças reutilizáveis:

- Botões de ação.
- Cartões de resumo.
- Indicadores de GPS.
- Componentes de mapa.
- Listas de atividade.

### `hooks`

Responsável por estado e integração com ciclo de vida:

- Hook de localização.
- Hook de atividade ativa.
- Hook de autenticação.
- Hook de dados do usuário.
- Hook de histórico.

### `services`

Responsável por regras e integrações:

- Serviço de atividades.
- Serviço de rotas.
- Serviço de território.
- Serviço de XP.
- Serviço de ranking.
- Serviço de Firestore.
- Serviço de corrida offline (`runOfflineStorageService`) para persistir a atividade ativa e recuperar corridas interrompidas.

### `config`

Responsável por configuração:

- Firebase.
- Variáveis de ambiente.
- Flags de feature.

## GPS

O módulo de GPS deve:

- Solicitar permissões.
- Iniciar e parar coleta.
- Diferenciar primeiro plano e segundo plano.
- Expor precisão e status.
- Filtrar ou marcar pontos inválidos.
- Evitar que telas precisem conhecer detalhes de validação.

Regras de GPS estão em [[05-gps-e-validacao]].

## Mapas

O mapa deve:

- Mostrar posição atual.
- Mostrar rota ativa.
- Mostrar rota finalizada.
- Mostrar território conquistado quando disponível.
- Evitar renderizar dados pesados sem simplificação.

Performance de mapa deve ser acompanhada desde o MVP.

## Território

A lógica de território deve ficar isolada para permitir troca de estratégia.

Possíveis responsabilidades:

- Converter rota válida em área.
- Identificar território novo.
- Calcular área ou células.
- Gerar dados persistíveis.
- Preparar renderização.

Regras de território estão em [[03-mecanica-territorios]].

## Firestore

O acesso ao Firestore deve:

- Usar funções claras por caso de uso.
- Separar resumo de atividade dos dados pesados de rota.
- Evitar consultas caras em telas frequentes.
- Facilitar paginação.
- Manter agregados consistentes.

Modelagem proposta em [[08-firebase-firestore]].

## Corrida offline-first

A arquitetura da corrida ativa segue esta separação:

- `MapScreen` controla interação, GPS em primeiro/segundo plano, timer e renderização da rota.
- `runTracking` filtra pontos, calcula distância, segmentos e qualidade.
- `runOfflineStorageService` persiste a corrida ativa localmente com pontos aceitos, segmentos, duração, distância e status.
- `sync.js` salva a corrida finalizada no histórico local e sincroniza com Firestore por fila, status e retry.
- Serviços de território podem persistir localmente e deixar envio remoto para a sincronização posterior.

Regra arquitetural:

- Firestore não deve ser chamado para iniciar, pausar, retomar, atualizar ponto, calcular métricas ou finalizar uma corrida ativa.
- Firestore só deve receber dados depois que a corrida estiver salva localmente.
- Se AsyncStorage se tornar insuficiente para atividades longas, a camada `runOfflineStorageService` deve migrar para SQLite/Expo SQLite sem mudar a interface usada pela tela.

## Turf.js ou biblioteca geográfica

Uma biblioteca geográfica pode ser usada para:

- Calcular distância.
- Simplificar rotas.
- Criar buffer ao redor de linhas.
- Calcular interseções.
- Trabalhar com polígonos.

Antes de adicionar ou ampliar dependência geográfica, avaliar:

- Tamanho no bundle.
- Performance no dispositivo.
- Complexidade da API.
- Necessidade real para o MVP.

## Pontos pendentes

- Biblioteca final de mapas.
- Estratégia final de território.
- Onde calcular território: app, backend ou híbrido.
- Estratégia de localização em segundo plano.
- Estratégia de compactação de rota.
- Uso de Cloud Functions para agregados e ranking.

## Documentos relacionados

- [[02-mvp]]
- [[05-gps-e-validacao]]
- [[08-firebase-firestore]]
- [[10-decisoes-do-projeto]]

