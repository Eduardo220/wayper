# Planos e entitlements

## Estado das decisões

- Free: **aprovado**;
- Wayper Plus: **aprovado conceitualmente**;
- Wayper Pro: **hipótese em avaliação**;
- acessos promocionais e temporários: **aprovados conceitualmente**;
- integração de cobrança: **não autorizada nesta fase**.

## Free

Deve permitir registrar e salvar atividades, acompanhar métricas essenciais,
conquistar territórios, participar do ranking e da progressão básicos, consultar
histórico e usar a experiência central com respeito.

## Wayper Plus

Pode combinar valor em:

- estatísticas e comparações avançadas;
- heatmaps, histórico e replay avançados;
- exportações e relatórios ampliados;
- temas, skins e personalizações;
- desafios, metas, grupos e competições avançadas;
- análises assistidas;
- benefícios de parceiros;
- armazenamento ou sincronização ampliada;
- ausência de anúncios, como benefício secundário.

Nenhum item da lista está implementado ou incluído automaticamente. Cada
capability precisa de decisão, teste e rollout próprios.

## Possível Wayper Pro

Só deve existir se atender organizadores, criadores ou comunidades com um
problema diferente do Plus: eventos, ligas, inscrições, gestão, dashboards e
premiações. Não criar apenas uma faixa mais cara.

## Contrato de acesso

Telas não devem ler `user.isPremium` diretamente. Um resolvedor central deve
considerar:

- plano e capabilities;
- origem e expiração;
- acesso temporário/promocional;
- restauração e último estado conhecido;
- ambiente e feature flags;
- fallback offline seguro.

Tracking, finalização, salvamento, recuperação e acesso aos dados básicos nunca
dependem de entitlement remoto.
