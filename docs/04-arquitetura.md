# Arquitetura do Sistema

## Visão geral

O Wayper é um aplicativo mobile construído com React Native e Expo. A persistência, autenticação e backend principal são baseados em Firebase, especialmente Firebase Auth e Firestore. O mapa utiliza MapLibre/OpenFreeMap, e cálculos geográficos podem usar Turf.

## Stack conhecida

| Camada | Tecnologia |
| --- | --- |
| App mobile | React Native |
| Build/dev | Expo e Expo Dev Client |
| Autenticação | Firebase Auth |
| Banco | Firestore |
| Backend/serviços | Firebase e possíveis scripts Node.js |
| Mapa | MapLibre React Native |
| Base de mapa | OpenFreeMap |
| Geolocalização | Expo Location |
| Geoprocessamento | Turf |
| Testes | Jest |
| Android build | Gradle via scripts do projeto |

## Ambientes

| Ambiente | Branch | Identificador esperado |
| --- | --- | --- |
| Desenvolvimento | `develop` | App/dev client, pacote dev |
| Produção | `main` | App oficial/release |

## Componentes principais

### App mobile

Responsável por:

- Autenticação do usuário.
- Navegação entre telas.
- Exibição do mapa.
- Registro de corrida.
- Leitura e escrita de dados no Firebase.
- Exibição de rankings, perfil, histórico e zonas.

### Firebase Auth

Responsável por:

- Login.
- Cadastro.
- Sessão autenticada.
- Identificação do usuário para regras de acesso.

### Firestore

Responsável por armazenar:

- Dados de usuário.
- Corridas.
- Rotas.
- Zonas conquistadas.
- Rankings agregados ou dados base para ranking.
- Relações sociais, se existirem.

### Mapa e localização

Responsável por:

- Mostrar posição atual.
- Desenhar rotas.
- Desenhar zonas conquistadas.
- Exibir áreas próprias e de outros usuários.
- Atualizar feedback visual durante a corrida.

## Fluxo macro de corrida

1. Usuário autentica.
2. Usuário abre tela de corrida/mapa.
3. App solicita permissão de localização.
4. Usuário inicia corrida.
5. App coleta pontos GPS.
6. App calcula métricas parciais.
7. Usuário finaliza corrida.
8. App valida a corrida.
9. App salva a corrida finalizada localmente na chave `runs`.
10. App enfileira sync remoto idempotente para Firestore.
11. App calcula/preserva dados de zonas quando a corrida for por zonas.
12. Ranking e histórico são atualizados a partir da base local e do sync posterior.

## Sync local-first de corridas

- A corrida ativa nao depende de Firestore.
- Corridas finalizadas entram no historico local por `sync.saveLocalRun()`.
- A fila de sync parte de `sync.loadLocalRunHistory()` e usa `localRunId`/`remoteRunId` para evitar duplicacao.
- Firestore e destino posterior; falhas remotas deixam a corrida visivel como `SYNC_FAILED`.
- Corridas por zonas preservam dados territoriais existentes; corridas livres nao recebem territorio falso.

## Pontos que precisam ser definidos

- Regra exata de transformação de rota em zona.
- Se ranking será calculado sob demanda ou pré-agregado.
- Estratégia antifraude.
- Modelo definitivo do Firestore.
- Se haverá Cloud Functions ou apenas lógica client-side no início.
- Política de cache/offline.
