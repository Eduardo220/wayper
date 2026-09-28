# Analytics da direção oficial

**Status:** eventos planejados; instrumentação não implementada nesta fase

Eventos medem saúde do produto sem colocar analytics no caminho crítico. A
ausência/falha do provider não altera nenhum fluxo. Coordenadas cruas, rota,
email, token ou payload sensível não são propriedades padrão.

## Corrida

- `run_started`;
- `run_paused`;
- `run_resumed`;
- `run_restored`;
- `run_finish_requested`;
- `run_minimum_saved`;
- `run_save_failed`;
- `expedition_processing_started`;
- `expedition_processing_completed`.

Propriedades permitidas devem privilegiar modo, origem, duração/faixa, estado
offline e código de erro sanitizado.

## Relatório

- `expedition_report_opened`;
- `expedition_report_closed`;
- `expedition_report_skipped`;
- `expedition_replay_opened`;
- `expedition_territory_revealed`;
- `expedition_achievement_opened`;
- `expedition_reward_opened`;
- `expedition_share_started`.

## Planos

- `plan_offer_opened`;
- `plan_benefit_viewed`;
- `checkout_started`;
- `subscription_confirmed`;
- `subscription_cancelled`;
- `subscription_restored`;
- `plan_converted`.

## Parceiros

- `partner_campaign_attributed`;
- `partner_reward_generated`;
- `partner_reward_shown`;
- `partner_reward_opened`;
- `partner_redemption_started`;
- `partner_redemption_completed`;
- `partner_conversion`.

## Regras

- identificadores são pseudonimizados e mínimos;
- evento financeiro confirmado vem de autoridade segura, não do callback visual;
- campanha não recebe rota detalhada;
- eventos de GPS de alta frequência são agregados localmente;
- consentimento e retenção seguem a finalidade;
- analytics pode ser desligado por ambiente/flag sem fallback funcional.
