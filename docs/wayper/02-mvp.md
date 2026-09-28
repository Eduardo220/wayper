# MVP

**Status:** snapshot histórico do escopo inicial. A direção vigente está em
`../product/`; o código atual já ultrapassou partes deste MVP. Afirmações sobre
território individual ou itens “fora” não anulam a implementação real nem
autorizam expandi-la sem decisão.

## Objetivo do MVP

O próximo marco de produto deve validar se usuários confiam no registro da
atividade e valorizam descobrir, depois dela, desempenho, trajeto, territórios e
progressão.

O MVP não deve tentar resolver clans, eventos, disputas complexas ou economia de jogo. A prioridade é provar o ciclo básico:

1. Usuário inicia uma atividade.
2. App registra GPS real.
3. Usuário encerra a atividade.
4. App confirma o salvamento mínimo.
5. App revela rota, distância, XP e território em módulos pós-corrida.
6. Dados e resultados parciais são persistidos para histórico e perfil.

## O que entra no MVP

- Cadastro e login.
- Permissão de localização.
- Tela de mapa.
- Início de caminhada ou corrida.
- Registro de rota com pontos GPS.
- Pausa, retomada e encerramento de atividade.
- Resumo da atividade.
- Cálculo inicial de distância.
- Cálculo inicial de XP.
- Nível do usuário com regra simples.
- Histórico de atividades.
- Perfil básico do usuário.
- Persistencia local-first com sync posterior/best effort para Firebase/Firestore.
- Mecânica inicial de território em formato simples, individual e documentado.

## O que fica fora do MVP

- Clans ou grupos.
- Ranking global em tempo real.
- Disputa direta por território.
- Posse compartilhada ou competitiva de território.
- Eventos temporários.
- Feed social.
- Chat.
- Skins, loja ou economia virtual.
- Anti-cheat avançado.
- Análise esportiva avançada.
- Planilhas de treino.
- Integração com wearables.
- Compartilhamento social completo.
- Moderação de conteúdo.

## Critérios de sucesso

O MVP será considerado bem-sucedido se:

- Um usuário novo conseguir entender a proposta sem explicação externa.
- O usuário conseguir iniciar e encerrar uma caminhada ou corrida sem erro crítico.
- O app salvar rota, distância, duração, XP e resumo.
- O mapa mostrar a rota de forma clara.
- A conquista territorial for visível e compreensível.
- A precisão do GPS for boa o suficiente para atividades urbanas comuns.
- O custo de leitura/escrita remota permanecer previsível porque os fluxos criticos nao gravam ponto a ponto no Firestore durante a corrida.
- O app não consumir bateria de forma inaceitável em atividades curtas.

## Riscos do MVP

- GPS impreciso gerar conquistas injustas.
- Firestore ficar caro se sync remoto futuro tentar gravar ponto GPS de forma ineficiente.
- Mapa ficar pesado com muitas rotas ou territórios.
- Usuário não entender a diferença entre rota registrada e território conquistado.
- Regras de conquista ficarem complexas cedo demais.
- Atividade em segundo plano falhar em alguns dispositivos.
- Fraude por localização falsa afetar rankings e conquista.

## Decisão de escopo

O escopo deve favorecer regras simples, rastreáveis e fáceis de explicar. O código
atual já contém elementos competitivos territoriais que divergem da decisão
histórica de progresso individual; a regra final precisa de consolidação antes de
expansão. Nenhuma mecânica pode aumentar o risco do GPS ou do salvamento.

## Documentos relacionados

- [[03-mecanica-territorios]]
- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[08-firebase-firestore]]

