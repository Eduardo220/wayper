# Portabilidade e reuso

**Status:** direção arquitetural aprovada  
**Escopo:** separar o que pode ser extraído sem transformar a Wayper em framework
prematuro.

## Específico da Wayper

- regras territoriais, linguagem da Expedição e progressão;
- identidade visual, fluxos e política de planos;
- campanhas, comunidades e competições Wayper;
- schemas de atividade e compatibilidade histórica do produto.

Essas partes podem inspirar outros produtos, mas não devem virar pacote genérico
sem segundo caso de uso real.

## Potencialmente reutilizável

- sessão de atividade local-first;
- coleta headless, filtros de GPS, checkpoints e recuperação;
- orquestração de finalização mínima;
- fila idempotente, retomável e observável;
- modelo de relatório modular com resultados parciais;
- contracts de entitlements, flags, ads e pagamentos;
- sanitização de diagnósticos e estratégia de sync.

Reuso exige extração de contratos e testes; copiar diretórios preserva
dependências invisíveis e não conta como portabilidade.

## Limites e adaptadores

| Capacidade | Regra de domínio | Adaptador substituível |
|---|---|---|
| Persistência local | corrida existe sem rede | AsyncStorage/SQLite/outro storage |
| Backend/sync | conflito, idempotência, status | Firebase ou API própria |
| Mapa | rota e geometria são dados | MapLibre/outro renderer |
| Analytics | eventos sem dados sensíveis | provider opt-in |
| Notificações | comandos/estado da atividade | Expo/nativo |
| Ads | política decide se pode | rede de anúncios |
| Pagamentos | estado e idempotência | gateway/loja |
| Assinatura | capabilities e expiração | subscription provider |

Código de domínio não importa SDK do adaptador. Repositories/providers convertem
erros externos para estados conhecidos e testáveis.

## Dependências atuais que limitam portabilidade

- `MapScreen` concentra UI e orquestração de vários domínios;
- algumas telas/hooks sociais acessam Firestore diretamente;
- caminhos legados de tracking, zonas e XP coexistem;
- o relatório pós-corrida não possui contrato próprio;
- ainda não há resolvedores centrais de flags ou entitlements.

Essas lacunas devem ser reduzidas por fase, sem reescrita total.

## Exemplos de substituição

### Firebase

Preservar contratos de repository, status local de sync e idempotency keys.
Implementar outro adapter e executar os mesmos testes de contrato. Tracking e
salvamento mínimo não mudam.

### Storage local

Versionar schema e migrations; portar primeiro a leitura e validar recovery antes
de mudar a escrita. Manter rollback compatível durante a transição.

### Mapa

Converter rota/território para um modelo neutro. O renderer recebe dados e eventos,
mas não decide captura, privacidade ou progressão.

### Analytics

Publicar eventos sem coordenadas cruas por padrão. Um adapter pode descartar tudo
sem alterar fluxo.

### Ads

`canShowAd` pertence à aplicação/política. O adapter pode retornar
“indisponível”; telas permanecem funcionais.

### Gateway

O domínio inicia intenção e observa estado confirmado. Trocar provider não altera
entitlements nem tracking.

### Notificações

Ações são comandos do runtime. O adapter traduz plataforma, mantendo o estado
canônico fora da notificação.

## Riscos ao copiar código

- transportar chaves de storage e schemas específicos;
- assumir permissões/background iguais em outra plataforma;
- copiar dependência Firebase escondida;
- reaproveitar singletons com ciclo de vida incompatível;
- confundir regra territorial com utilitário geográfico genérico;
- omitir privacy, consentimento e migrações.

Antes de extrair, é obrigatório existir contrato estável, teste de comportamento,
inventário de dependências e ao menos um consumidor concreto adicional.
