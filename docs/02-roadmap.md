# Roadmap

Este roadmap organiza a evolução do Wayper por fases. Datas devem ser adicionadas quando o planejamento estiver fechado.

## Fase 0: Base funcional

Objetivo: manter o app executável, com autenticação, navegação básica, mapa e registro inicial de corrida.

### Itens

- [ ] Validar fluxo de login/cadastro.
- [ ] Validar persistência do usuário autenticado.
- [ ] Confirmar funcionamento do mapa em Android.
- [ ] Confirmar permissão de localização.
- [ ] Garantir scripts de desenvolvimento funcionando.
- [ ] Documentar variáveis de ambiente necessárias.

## Fase 1: Corrida e rastreamento

Objetivo: permitir iniciar, acompanhar, pausar/finalizar e salvar corridas.

### Itens

- [ ] Iniciar corrida.
- [ ] Capturar localização em tempo real.
- [ ] Calcular distância.
- [ ] Calcular tempo.
- [ ] Calcular ritmo/velocidade.
- [ ] Finalizar corrida.
- [ ] Salvar histórico no Firestore.
- [ ] Tratar GPS fraco, permissão negada e perda de sinal.

## Fase 2: Zonas conquistadas

Objetivo: transformar rotas em áreas conquistadas no mapa.

### Itens

- [ ] Definir regra oficial de geração de zona.
- [ ] Definir tamanho mínimo de rota válida.
- [ ] Calcular área conquistada.
- [ ] Evitar duplicação abusiva de áreas.
- [ ] Exibir zonas do usuário no mapa.
- [ ] Exibir zonas de outros usuários.
- [ ] Definir regra de conflito/disputa territorial.

## Fase 3: Ranking e competição

Objetivo: criar competição saudável entre usuários.

### Itens

- [ ] Ranking por área total dominada.
- [ ] Ranking por número de zonas.
- [ ] Ranking por distância acumulada.
- [ ] Ranking semanal/mensal/global.
- [ ] Perfil público básico.
- [ ] Tratamento contra fraude de GPS.

## Fase 4: Social e grupos

Objetivo: permitir competição entre amigos e comunidades.

### Itens

- [ ] Sistema de amigos.
- [ ] Grupos.
- [ ] Ranking por grupo.
- [ ] Convite por link ou código.
- [ ] Compartilhamento de conquistas.

## Fase 5: Produção

Objetivo: preparar versão oficial estável.

### Itens

- [ ] Build Android release.
- [ ] Configurar assinatura.
- [ ] Revisar permissões.
- [ ] Revisar segurança do Firebase.
- [ ] Configurar monitoramento de erros.
- [ ] Criar checklist de publicação.
- [ ] Sincronizar `develop` em `main` via pull request.

## Fora de escopo por enquanto

- Monetização.
- Marketplace.
- Treinos pagos.
- Integração com relógios.
- iOS em produção, salvo decisão futura.
