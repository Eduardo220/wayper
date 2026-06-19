# MVP

## Objetivo do MVP

O MVP da Wayper deve validar se usuários entendem e valorizam a ideia principal: caminhar ou correr no mundo real para conquistar territórios no mapa.

O MVP não deve tentar resolver clans, eventos, disputas complexas ou economia de jogo. A prioridade é provar o ciclo básico:

1. Usuário inicia uma atividade.
2. App registra GPS real.
3. Usuário encerra a atividade.
4. App mostra rota, distância, XP e território conquistado.
5. Dados são persistidos para histórico e perfil.

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

O MVP deve favorecer regras simples, rastreáveis e fáceis de explicar. Território no MVP deve ser progresso individual do usuário, não posse global disputável. Qualquer feature que aumente muito a complexidade de GPS, mapa, Firestore ou ranking deve ser tratada como proposta futura e registrada em [[10-decisoes-do-projeto]].

## Documentos relacionados

- [[03-mecanica-territorios]]
- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[08-firebase-firestore]]

