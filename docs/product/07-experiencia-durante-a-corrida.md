# Experiência durante a corrida

**Status:** aprovada  
**Situação atual:** parcialmente implementada

## Objetivo

Durante a atividade, a Wayper registra, protege e preserva. O usuário deve poder
guardar o celular e continuar.

## Interface essencial

- tempo;
- distância;
- pace;
- estado da atividade;
- qualidade crítica do GPS;
- pausa, retomada e finalização;
- informação essencial de segurança.

São opcionais: áudio, vibração, notificação persistente, modo foco, mapa e
bloqueio contra toques. Mapa não é requisito para a atividade.

## Comportamentos proibidos

- procurar ou resgatar territórios, missões e benefícios;
- anúncios, ofertas, upgrade ou compra;
- animações que exijam atenção;
- decisão de parceiro ou recompensa;
- navegação comercial;
- incentivo a desvios inseguros.

## Condições obrigatórias

A atividade deve tolerar tela apagada, bloqueio, background, outro aplicativo,
ausência de internet, oscilação de GPS, recriação da UI, reabertura por
notificação/ícone e restrições de bateria dentro dos limites documentados da
plataforma.

Territórios atravessados, conquistas e disputas são registrados silenciosamente
ou processados depois. Modos territoriais futuros devem ser escolhidos antes,
opcionais, não intrusivos e seguros.

## Lacuna atual

`MapScreen` ainda mantém mapa e captura de zonas como centro visual e não exibe
pace no painel mínimo. A mudança deve vir por modo foco e flag, sem reescrever o
tracking.
