# Economia e recompensas

## Status

- XP, níveis e medalhas existentes: **parcialmente implementados**;
- recompensas internas/patrocinadas: **aprovadas conceitualmente**;
- WayCoins, passes, baús e recompensas aleatórias: **hipóteses**;
- moeda conversível, carteira e transferência: **não autorizadas**.

## Recompensa

Uma recompensa futura precisa de identificador, tipo, origem, campanha,
elegibilidade, validade, quantidade/estoque, status, regra de resgate,
`idempotencyKey` e auditoria.

Tipos possíveis incluem XP, item, skin, medalha, benefício, desconto, acesso
temporário, inscrição, Plus temporário ou prêmio de desafio.

## Regras

- concessão acontece no domínio/processamento, não na UI;
- reprocessamento não duplica concessão;
- falha de estoque, parceiro ou rede não invalida a atividade;
- elegibilidade não confia apenas no cliente;
- valores e eventos são auditáveis;
- localização detalhada não é requisito implícito;
- moeda interna exige antes regras de origem, uso, expiração, antifraude, compra,
  transferência, contabilidade, legal e lojas de aplicativos.
