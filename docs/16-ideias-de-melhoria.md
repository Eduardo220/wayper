# Ideias de Melhoria

Este arquivo guarda ideias sugeridas por humano ou IA. Ideias aqui não são decisões oficiais e não podem ser implementadas automaticamente.

## Status possíveis

- Nova
- Em análise
- Aprovada
- Rejeitada
- Adiada
- Implementada

## Formato obrigatório

```md
## [Título da ideia]

Status:
Origem:
Data:
Área:
Prioridade sugerida:

### Contexto

### Problema que resolve

### Proposta

### Exemplo prático

### Impacto no produto

### Impacto técnico

### Riscos

### Relação com o MVP

### Documentos relacionados

### Recomendação da IA

### Decisão humana
```

## Exemplo: Suavização da linha da corrida

Status: Exemplo, não decisão oficial
Origem: IA
Data: 2026-05-27
Área: GPS, mapa, UX
Prioridade sugerida: Alta para o MVP, se a rota visual estiver tremida

### Contexto

A Wayper depende de rotas reais para histórico, território e confiança do usuário. Se a linha da corrida tremer demais, o mapa parece impreciso mesmo quando a atividade foi válida.

### Problema que resolve

Reduzir ruído visual na linha da corrida sem cortar caminho, inventar rota ou apagar trechos válidos.

### Proposta

Aplicar suavização ou simplificação conservadora apenas na rota visual, mantendo os pontos brutos ou validados disponíveis para auditoria quando necessário.

### Exemplo prático

Durante uma corrida em uma rua reta, pequenos desvios laterais causados por GPS ruim seriam suavizados visualmente, mas um desvio real por outra rua continuaria aparecendo.

### Impacto no produto

Melhora confiança e leitura do mapa.

### Impacto técnico

Afeta GPS, mapa, persistência de rota, performance e possível cálculo de território.

### Riscos

- Suavizar demais e cortar caminho.
- Gerar diferença entre rota exibida e território calculado.
- Esconder problemas reais de GPS.

### Relação com o MVP

Alinhada com o MVP se limitada à confiabilidade visual da corrida e do mapa.

### Documentos relacionados

- [[05-gps-e-validacao]]
- [[03-mecanica-territorios]]
- [[04-arquitetura]]
- [[10-regras-de-negocio]]

### Recomendação da IA

Tratar como proposta técnica antes de implementar, definindo diferença entre rota bruta, rota validada e rota exibida.

### Decisão humana

Pendente.

## Exemplo: Desafios semanais por bairro

Status: Exemplo, não decisão oficial
Origem: IA
Data: 2026-05-27
Área: Gamificação, ranking, mapa
Prioridade sugerida: Baixa para o MVP

### Contexto

Desafios semanais podem incentivar recorrência e exploração urbana.

### Problema que resolve

Dar motivo claro para o usuário voltar ao app toda semana.

### Proposta

Criar desafios por bairro, como "complete 3 atividades nesta região" ou "explore 2 km de rotas novas".

### Exemplo prático

Na segunda-feira, o usuário recebe um desafio para explorar uma área do bairro onde costuma correr.

### Impacto no produto

Aumenta retenção e exploração, mas aproxima o produto de eventos e competição.

### Impacto técnico

Exige definição de bairros, agenda, regras de desafio, persistência, possíveis rankings e antifraude.

### Riscos

- Ficar fora do MVP.
- Aumentar custo no Firestore.
- Exigir dados geográficos que ainda não estão definidos.
- Criar incentivo competitivo antes de validação antifraude.

### Relação com o MVP

Alinhada com a visão, mas fora do MVP atual.

### Documentos relacionados

- [[02-roadmap]]
- [[03-backlog]]
- [[02-mvp]]
- [[06-xp-nivel-ranking]]

### Recomendação da IA

Manter como ideia futura até corrida, histórico, zonas e GPS estarem confiáveis.

### Decisão humana

Pendente.

## Exemplo: Alerta visual para GPS fraco

Status: Exemplo, não decisão oficial
Origem: IA
Data: 2026-05-27
Área: GPS, UX, corrida
Prioridade sugerida: Alta para o MVP

### Contexto

O GPS é base da Wayper. O usuário precisa saber quando a atividade está sendo registrada com qualidade baixa.

### Problema que resolve

Evitar surpresa ao final da corrida quando distância, XP ou território forem reduzidos por pontos inválidos.

### Proposta

Mostrar indicador visual simples durante a atividade ativa quando a precisão estiver ruim ou instável.

### Exemplo prático

Durante a corrida, o topo da tela mostra "GPS fraco" enquanto pontos acima do limite são ignorados para território.

### Impacto no produto

Aumenta transparência e reduz frustração.

### Impacto técnico

Exige expor qualidade do GPS no estado da atividade, refletir isso no mapa e registrar qualidade no resumo.

### Riscos

- Alertas excessivos irritarem o usuário.
- Usuário abandonar atividade por mensagem pouco clara.
- Mostrar aviso sem explicar impacto real.

### Relação com o MVP

Alinhada com o MVP.

### Documentos relacionados

- [[05-gps-e-validacao]]
- [[04-regras-corrida]]
- [[06-fluxos-de-usuario]]
- [[10-regras-de-negocio]]

### Recomendação da IA

Converter em proposta pendente quando o fluxo de atividade ativa estiver sendo revisado.

### Decisão humana

Pendente.
