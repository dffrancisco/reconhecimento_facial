# web-admin — usuários

Uma tela no admin para incluir, alterar, excluir e trocar a senha dos usuários (os operadores), sem o comando `criarOperador` no terminal do servidor.

Continua o [design do admin](2026-09-27-web-admin-eventos-design.md): identidade visual, cabeçalho, sessão e jeito de chamar a API são os de lá.

## 1. Objetivo

Hoje o operador só nasce pelo `node dist/scripts/criarOperador.js` no terminal do serviço `api`, e não há como excluir ninguém. Também não há como cortar uma sessão: o token vale 12 h, e quem foi tirado do banco segue entrando até ele vencer.

**Sucesso:** quem está no admin abre "Usuários", cria um login para outra pessoa e ela entra no admin na hora e no painel da estação em até 1 minuto. Excluir alguém, ou trocar a senha dele, tira o acesso dele já na próxima ação.

## 2. Quem pode

Todos os operadores são iguais, como hoje: qualquer um que entra no admin gerencia os usuários, inclusive a senha dos outros. Não há perfil de administrador.

As proteções:

- ninguém exclui a si mesmo;
- o último usuário não pode ser excluído (o admin nunca fica sem ninguém para entrar);
- dois operadores excluindo um ao outro ao mesmo tempo não zeram a lista: a exclusão trava os usuários ativos antes de contar.

## 3. As telas

O cabeçalho ganha o link **"Usuários"** ao lado de "Eventos".

### 3.1 Usuários — `/#/usuarios`

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● Admin   Eventos   Usuários                    Francisco · Sair     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Usuários                                          [ Novo usuário ]  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ NOME              LOGIN       CRIADO EM                        │  │
│  │ Baima             baima       02/10/2026  Alterar Senha Excluir│  │
│  │ Francisco (você)  francisco   20/09/2026  Alterar Senha        │  │
│  │ Wallas            wallas      05/10/2026  Alterar Senha Excluir│  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

- Só os ativos, em ordem de nome. A própria linha leva "(você)" e não tem "Excluir".
- Com um usuário só, ninguém tem "Excluir".
- "Senha" abre a troca de senha daquele usuário.
- Os erros da API aparecem dentro da janela aberta, sem apagar o que foi preenchido.

### 3.2 Novo usuário e Alterar

```
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│ Novo usuário                     │      │ Alterar Wallas                   │
│                                  │      │                                  │
│ Nome            [              ] │      │ Nome            [ Wallas       ] │
│ Login           [              ] │      │ Login           [ wallas       ] │
│ Senha           [              ] │      │                                  │
│ Confirmar senha [              ] │      │         [ Cancelar ] [ Salvar ]  │
│                                  │      └──────────────────────────────────┘
│        [ Cancelar ] [ Criar ]    │
└──────────────────────────────────┘
```

| Campo | Regra |
|---|---|
| Nome | Obrigatório, até 100 caracteres. |
| Login | Obrigatório. Vai para minúsculas e sem espaços nas pontas; depois, de 3 a 60 caracteres entre `a-z`, `0-9`, ponto, hífen e sublinhado. Texto de apoio: "Letras minúsculas, números, ponto, hífen ou sublinhado." |
| Senha | Pelo menos 8 caracteres (a regra do `criarOperador`), no máximo 200. Só no "Novo usuário". |
| Confirmar senha | Igual à senha. Conferido na tela, antes de chamar a API. |

- Login de um usuário ativo: "Esse login já é de outro usuário."
- No **Novo usuário**, login de alguém que foi excluído traz aquele cadastro de volta, com o nome e a senha novos (é o que o `criarOperador` já faz).
- No **Alterar**, login de qualquer outro cadastro, ativo ou excluído, dá a mesma mensagem de "já é de outro usuário" (o login é único na tabela inteira).
- Alterar o próprio nome atualiza o nome no cabeçalho.

### 3.3 Trocar senha

```
┌──────────────────────────────────────────┐
│ Trocar a senha de Wallas                 │
│                                          │
│ Nova senha          [                  ] │
│ Confirmar a senha   [                  ] │
│                                          │
│ As sessões abertas dele com a senha      │
│ antiga param de valer.                   │
│                                          │
│              [ Cancelar ] [ Trocar ]     │
└──────────────────────────────────────────┘
```

- Mesmas regras da senha do 3.2. Não pede a senha atual: qualquer operador pode trocar a de qualquer um, então pedir só valeria para a própria e não protegeria nada.
- Na própria senha, o aviso vira "Você continua conectado neste navegador; nos outros, precisa entrar de novo."

### 3.4 Excluir

```
┌──────────────────────────────────────────┐
│ Excluir Wallas?                          │
│                                          │
│ Ele perde o acesso ao admin na hora e ao │
│ painel da estação em até 1 minuto.       │
│                                          │
│              [ Cancelar ] [ Excluir ]    │
└──────────────────────────────────────────┘
```

- Exclusão lógica (`deletado = 'S'`), como no resto do projeto. O cadastro fica no banco e some da lista.
- Recusas da API: "Você não pode excluir a si mesmo." e "Precisa sobrar pelo menos um usuário."

## 4. Sessão que cai

O token assinado de hoje (`id_operador` + validade) ganha uma **versão da senha**: os primeiros 16 caracteres do SHA-256 do `senha_hash` do operador. Ela vai dentro da parte assinada, então não dá para forjar.

A cada chamada autenticada, o `autorizarOperador` passa a ler o operador no banco e só aceita se ele estiver ativo e a versão do token bater com a do `senha_hash` atual. Assim:

- **excluir** corta o acesso na próxima ação, com o "Sessão expirada, faça login novamente." de sempre;
- **trocar a senha** muda o `senha_hash` e invalida todos os tokens antigos daquela pessoa;
- na troca da **própria** senha, a API devolve um token novo e a tela troca a sessão guardada, sem pedir login.

Na estação vale o mesmo, pelo banco dela: a sincronização já copia `senha_hash` e `deletado` a cada 60 s, então o painel corta o acesso em até 1 minuto, sem mudança na sincronização.

O login passa a aceitar o login digitado com maiúsculas ou espaços nas pontas (normaliza igual ao cadastro). Os logins de hoje (`francisco`, `baiba`, `baima`, `wallas`) já seguem a regra.

**Efeito da publicação:** os tokens de hoje não têm a versão, então todos precisam entrar de novo uma vez. Sem migration: nenhuma coluna nova.

## 5. API no VPS

Módulo novo `apps/api/src/_ADMIN/operador/` no padrão do projeto (`route.`, `ctrl.`, `sql.`, `regras.` com as validações puras e `operador.http`), registrado como `POST /api/admin/operador`. Todas as chamadas exigem o operador autenticado. Nenhuma devolve o `senha_hash`.

| `call` | Corpo | Devolve |
|---|---|---|
| `listarOperadores` | — | `[{ id_operador, nome, login, criado_em }]`, só ativos, por nome |
| `criarOperador` | `nome, login, senha` | `{ id_operador }` |
| `alterarOperador` | `id_operador, nome, login` | `{ ok: true }` |
| `trocarSenha` | `id_operador, senha` | `{ ok: true }`, mais `token` quando é a própria senha |
| `excluirOperador` | `id_operador` | `{ ok: true }` |

O `alterarOperador` grava com `SET nome = ?, login = ?` fixo: a tela manda os dois sempre. O contrato fica comentado no topo do `sql.operador.ts`.

O script `criarOperador` continua existindo, para o caso de ninguém mais conseguir entrar, e passa a usar as mesmas regras de login e senha do módulo.

## 6. Arquitetura da tela

`apps/web-admin/src/pages/usuarios/` no padrão das outras telas: `index.vue`, `usuarios.ts` (`state` e `actions`), `interfaces.ts`, `services/usuarios.service.ts` e `usuarios.test.ts`. As janelas usam o `modal modal-open` do daisyUI, como a remoção de fotógrafo. A rota `/usuarios` entra no `router.ts`, atrás da mesma guarda de sessão.

## 7. Testes

- **Regras (node:test):** normalização e formato do login, tamanho da senha.
- **Token (node:test):** a versão da senha vai no token; token de outra versão, sem versão ou adulterado é recusado.
- **Integração (Postgres de dev):** criar, listar, alterar, trocar senha e excluir; login repetido; reativar o login de um excluído; não excluir a si mesmo nem o último; sessão recusada depois de excluir e depois de trocar a senha; token novo na troca da própria senha.
- **Tela (vitest):** lista com "(você)" e sem "Excluir" na própria linha; confirmar senha diferente não chama a API; erro da API aparece na janela; trocar a própria senha guarda o token novo; link "Usuários" no cabeçalho.
- **À mão, antes de publicar:** rodar o admin aqui com a API local, criar, alterar, trocar senha e excluir, e conferir que a sessão do excluído cai.

## 8. Fora desta etapa

- Perfis e permissões (administrador e operador comum).
- Histórico de quem criou, alterou ou excluiu.
- "Esqueci a senha" por e-mail ou WhatsApp. Quem esquece pede a outro operador para trocar.
- Mostrar e reativar os excluídos pela tela (o "Novo usuário" com o mesmo login já reativa).
