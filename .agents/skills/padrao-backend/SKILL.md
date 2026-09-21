---
name: padrao-backend
description: Use when creating a new route/module under src/_ADMIN (or the other area folders), adding a `call` to an existing one, or writing SQL against a tenant database in the erp_server repo
---

# Padrão Backend Wayap

## Overview

Express + TypeScript + Postgres multi-tenant. Uma rota por módulo, despacho por `call` no body — não há verbos REST.

**Princípio central:** espelhe [src/\_template/](../../../src/_template/). Ele é o par do `src/pages/_Template/` no `erp_admin_v2` — os dois lados da **mesma** entidade (favorecidos). Lendo os dois juntos você vê o contrato inteiro, do input do formulário até o `UPDATE`.

Comandos, migrations, build e o papel de cada arquivo estão no [AGENTS.md](../../../AGENTS.md). Esta skill cobre o que o AGENTS.md não cobre: **as armadilhas e os defaults**.

### ⚠️ O `_template` está desatualizado em 5 pontos

Copie a estrutura dele, mas **não** replique estes:

| No `_template`                      | O certo                                             | Onde                         |
| ----------------------------------- | --------------------------------------------------- | ---------------------------- |
| Assinatura `(req, res)`             | só `(req)` — o `res` chega `undefined`              | `route._template.ts:23`      |
| `this.usuario.id_empresa` no insert | `this.conexao.id_empresa` (resto do arquivo já usa) | `sql._template.ts:64`        |
| `param.new` cru no `updateParam`    | allowlist de campos antes (mass assignment)         | `sql._template.ts:46`        |
| `${field}` do body direto no SQL    | validar contra lista fixa                           | `sql._template.ts:36-39`     |
| `insertLog` sem `await`             | `await` — o `per` fecha a conexão no `finally`      | `ctrl._template.ts:28,36,46` |

Os cinco estão detalhados abaixo.

---

## Estrutura do Módulo

`src/_ADMIN/<rota>/` — copie de `src/_template/`:

| Arquivo           | Papel                                                        |
| ----------------- | ------------------------------------------------------------ |
| `route.<rota>.ts` | classe `Router` fina: só dispatch e validação de presença    |
| `ctrl.<rota>.ts`  | regra de negócio + auditoria                                 |
| `sql.<rota>.ts`   | só query                                                     |
| `i.<entidade>.ts` | interfaces — **opcional**, veja abaixo                       |
| `<rota>.http`     | requisições de teste (REST Client) — 107 dos 124 módulos têm |

**Sobre as interfaces:** só crie se a `ctrl` **manipula** o dado antes de devolver; se ela só repassa o resultado da query, não precisa de arquivo (regra do AGENTS.md). Se criar, use `i.<nome>.ts` — é o padrão novo, mas hoje tem 1 ocorrência contra 99 `interfaces.ts` nos módulos antigos. Não renomeie os existentes.

Convenção de nome: **pasta e rota no plural, tabela no singular** (`transportadoras/` → tabela `transportadora`, `cargos/` → `cargo`).

Registro em `src/routes/adminRoute.ts`, duas linhas:

```ts
import routeMotoristas from "../_ADMIN/motoristas/route.motoristas";
// ...
router.post('/motoristas', auth.authorize, routeMotoristas),
```

`auth.authorize` **não é opcional** — sem ele o token não é validado e o `per` cai no ramo sem autenticação. URL final: `POST /admin/<rota>`.

---

## Como o Despacho Funciona

`src/services/per.controllers.ts` faz tudo por reflexão:

1. decodifica o JWT → `new Router(user, id_empresa)`
2. `let call = req.params?.rota || req.body?.call`
3. `await route.init()` → abre a conexão
4. erro se `route[call] == undefined`
5. `await route[call](req)`
6. `finally` → **fecha a conexão sempre**

### ⚠️ O método recebe só `req`

Linha 50 do `per.controllers.ts` é `await route[call](req)` — **um argumento**. As assinaturas do `_template` declaram `(req: Request, res: Response)`, mas esse `res` chega `undefined`. Não tente responder por ele: **retorne o valor** e deixe o `per` serializar.

```ts
async getMotoristas(req: Request) {          // sem `res`
    return this.ctr.getMotoristas(req.body.offset, req.body.param);
}
```

O retorno vira resposta assim: `null` → `[]`; objeto com `.status` → `res.status(...).send(rs.data)`; objeto com `.data` → `res.send(rs.data)`; qualquer outra coisa → `res.send(rs)`.

Validação de obrigatório fica na Router e retorna objeto de erro, não `throw`:

```ts
async update(req: Request) {
    const { id_motorista, param } = req.body;
    if (!id_motorista) return { msg: 'campo id_motorista é obrigatório', error: true };
    return this.ctr.update(id_motorista, param);
}
```

---

## Multi-Tenant — Dois Níveis

| Nível              | O que é                             | Como se resolve                                                                                                               |
| ------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Sociedade**      | um banco Postgres inteiro           | `new ConexaoPostgres(usuario.id_sociedade)` no constructor. Escolhido o banco, o isolamento é total — você não faz mais nada. |
| **Empresa (loja)** | coluna `id_empresa` dentro do banco | `this.conexao.id_empresa = this.id_empresa` no constructor; **toda query filtra por ele**.                                    |

**Os dois vêm do JWT. Nunca leia `id_empresa` do body** — seria trocar de loja informando um número.

Use `this.conexao.id_empresa` em todo lugar. (`sql._template.ts:64` usa `this.usuario.id_empresa` no insert — mesmo valor, mas não replique a divergência.)

**Decisão explícita por entidade:** nem todo cadastro filtra por loja. `favorecidos` filtra; `transportadora`, `cargo` e `descricao_dispesa` gravam `id_empresa` mas **não filtram** na leitura, virando cadastro compartilhado entre as lojas do tenant; `produto` nem tem a coluna. Não copie por acaso — decida se a entidade é por loja ou do tenant, e aplique a mesma decisão em **SELECT, UPDATE, DELETE e `getDuplicidade`**.

Tabelas globais (menu, categoria) ficam no banco `helper`, aberto explicitamente: `new ConexaoPostgres('helper')`.

---

## SQL

Placeholder é `?`, traduzido para `$N` por `parseParams` (`src/db/postgresConnect.ts`):

```ts
this.conexao.queryParam(sql, values); // SELECT / INSERT ... RETURNING
this.conexao.executeParamCount(sql, values); // UPDATE / DELETE → devolve rowCount
```

**Não misture `?` com `$N` na mesma query** — lança erro explícito. Se precisar de `$N` nativo (cast `::`, `?` dentro de texto), use só `$N`.

Listagem — paginação por `offset`, `LIMIT 30` fixo, sem `count(*)` (é scroll infinito no xGridV2):

```ts
async getMotoristas(offset: number, param: iMotorista) {
    let values: any[] = [this.conexao.id_empresa];

    let sql = `SELECT id_motorista, nome, trim(cpf) cpf
                 FROM motorista
                WHERE id_empresa = ?
                  AND deletado = 'N'`;

    if (param.nome) {
        sql += ` AND nome ILIKE ?`;
        values.push(`%${param.nome}%`);
    }

    sql += ` ORDER BY nome LIMIT 30 OFFSET ?`;
    values.push(offset);

    return this.conexao.queryParam(sql, values);
}
```

`trim()` nas colunas `char(n)` legadas — sem isso o front recebe padding.

### ⚠️ Produto: **leia** pela `v_produto`, **escreva** nas tabelas base

Desde que o valor de venda passou a ser por loja, `custo` e `venda` têm **duas origens possíveis**: `produto` (empresa em modo `M` — quem manda é a matriz) ou `produto_estoque` (modo `L` — a loja tem preço próprio). Quem resolve isso é a view:

```sql
CASE WHEN COALESCE(e.valor_venda, 'M') = 'M' THEN COALESCE(b.custo, 0) ELSE COALESCE(a.custo, 0) END
```

**`SELECT venda FROM produto` devolve o preço da matriz para uma loja que tem preço próprio.** Não dá erro, não dá exceção: devolve o número errado. Por isso, em consulta, **o default é `v_produto`** — a tabela `produto` é a exceção, não o contrário.

A view também já entrega o que só existe em `produto_estoque` (`quantidade`, `end_estoque`, `end_excesso`, `curva_abc_g`, `qto_minima`, `st`, `cest`…) por `LEFT JOIN`, então produto sem linha de estoque continua aparecendo, zerado — e para `unidade = 'KL'` a `quantidade` sai de `fn_qtd_kit_disponivel()`, que só a view chama. Recriar essa lógica na mão em cada rota é como o bug do preço nasce.

**A armadilha da view: ela faz `CROSS JOIN empresa`, então é uma linha POR LOJA.**

```sql
-- ERRADO: devolve N linhas (uma por loja); queryOneParam pega uma qualquer
SELECT quantidade, venda FROM v_produto WHERE cod_produto = ?

-- CERTO
SELECT quantidade, venda FROM v_produto WHERE cod_produto = ? AND id_empresa = ?
```

Omitir o `id_empresa` só é correto quando a intenção é **varrer as lojas** — é o que a rota `consultaLojas` faz de propósito, e é o que dispensou a conexão por loja do `pecaOnline` antigo.

**Continue nas tabelas base quando:**

| Caso                           | Onde                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `UPDATE` / `INSERT`            | A view tem join: não é atualizável. Campo de catálogo → `produto`; campo da loja → `produto_estoque`.                                                                    |
| `custo` / `venda` numa escrita | **Não decida sozinho:** `decidirDestinoPreco()` em `src/_ADMIN/produto/precoDestino.ts` diz em qual(is) tabela(s) gravar, e recusa quando a loja não pode alterar preço. |
| Coluna que a view não expõe    | `altura, largura, comprimento, peso_bruto, peso_liquido, video_youtube, cclass_trib, cst_ibscbs` → `JOIN produto`.                                                       |

**A `v_produto` não é idêntica em todos os tenants.** `CREATE OR REPLACE VIEW` só chega pela migration, e banco que não recebeu a última fica para trás — `qtd_similar`/`qtd_correlata` existem na view do `dev` e **não** existem na do `taguapecas`. Confira a coluna no banco alvo antes de usá-la:

```bash
psql ... -d <tenant> -tAc "SELECT 1 FROM information_schema.columns WHERE table_name='v_produto' AND column_name='<coluna>'"
```

---

## Update: `prepareSql.updateParam` Define o Contrato com o Front

`prepareSql.updateParam(tabela, campos, where, id_empresa)` monta o `SET` **a partir das chaves do objeto** — só atualiza o que veio. É isso que permite o front mandar apenas o diff (`getDiffTwoJson`).

**O envelope do update tem duas camadas — não confunda:**

```
req.body = { call, id_motorista, param: { old: {...}, new: {...}, diff: true } }
                                  └─ a Router repassa `param` inteiro
                                     a ctrl desembrulha: sql.update(id, param.new)
                                     a sql recebe só o bag de colunas
```

`param.old` não é enfeite — alimenta a auditoria (`insertLogNormatize`). Router repassa o envelope, **ctrl desembrulha**, sql só vê colunas:

```ts
// ctrl
async update(id_motorista: number, param: any) {
    const rs = await this.sql.update(id_motorista, param.new);
    if (rs > 0)
        await this.sqlLog.insertLogNormatize(param.new, param.old);
    return { row: rs };
}

// sql
async update(id_motorista: number, campos: any) {
    const rt = prepareSql.updateParam('motorista', campos, 'id_motorista = ?', this.conexao.id_empresa);
    return this.conexao.executeParamCount(rt.sql, [...rt.obj, id_motorista]);
}
```

A ordem `[...rt.obj, id_motorista]` importa: os `?` são numerados da esquerda para a direita, e o do `WHERE` vem depois dos do `SET`.

**Escolha consciente, porque o front depende dela:**

| Se o `update` usa                         | O front manda                                                           | Auditoria                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `prepareSql.updateParam`                  | `param: dadosDiff` (ou `dadosDiff.new`)                                 | `insertLogNormatize(new, old)` fica limpo — só o que mudou |
| `UPDATE ... SET col1 = ?, col2 = ?` à mão | registro **completo** — campo ausente vira `undefined` e apaga a coluna | log polui com `X -> X`                                     |

Prefira `updateParam` em módulo novo. Se escrever o SQL à mão, **diga isso a quem for fazer a tela** — mandar diff contra `SET` fixo zera a linha.

### 🔒 Whitelist é obrigatório — no `updateParam` **e** no `insertParam`

Os dois iteram **todas** as chaves recebidas (`prepareSql.ts:37-43` e `:86-90`), e os módulos antigos passam `req.body.param` / `param.new` crus — quem manda o body decide quais colunas entram na query.

A gravidade difere entre os dois:

|                                   | `insertParam`                                                                     | `updateParam`                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `id_empresa` forjado              | **bloqueado** — `prepareSql.ts:35` sobrescreve com o valor do token antes do loop | **passa** — vira `SET id_empresa = ?` e move o registro para outra loja |
| Outras colunas fora do formulário | passam                                                                            | passam (inclusive a própria PK e `deletado`)                            |

O `WHERE` do update continua preso à loja do token, então só alcança registro que o usuário já vê — mas o `SET` o tira de lá.

```ts
const CAMPOS_EDITAVEIS = ["nome", "cpf", "cnh", "validade_cnh", "telefone"];

const seguro: any = {};
for (const k of CAMPOS_EDITAVEIS) if (k in campos) seguro[k] = campos[k];

// updateParam com objeto vazio gera `update t set  where ...` → SQL inválido
if (Object.keys(seguro).length === 0) return 0;
```

**O guard do objeto vazio não é opcional.** `prepareSql.ts:92` faz `''.substr(0, -2)` quando não há chave, e o `SET` sai vazio. A whitelist é justamente o que pode esvaziar o objeto (front mandou só chaves não-listadas), então ela e o guard andam juntos.

Dois detalhes do `insertParam`:

- ele **injeta `id_empresa` sozinho** — não mande esse campo, e não o inclua na whitelist;
- ele **muta o objeto que você passou** (`prepareSql.ts:35`). É por isso que `ctrl._template.ts:45` consegue devolver `param` já com o id dentro. Se você depende do objeto original intacto, clone antes.

### ⚠️ O filtro de tenant do `updateParam` é concatenado, não parametrizado

`prepareSql.ts:97-98` faz `sql += \`and id_empresa = ${id_empresa}\``. Hoje o valor vem do JWT e não é atacável, mas duas consequências práticas:

- se `id_empresa` escapar na whitelist, a query sai com `SET id_empresa = ?` **e** `and id_empresa = N` — a linha muda de loja em silêncio;
- `per.controllers.ts:14` entrega `id_empresa` como **string** (`let id_empresa = '0'`), enquanto os constructors declaram `id_empresa: number`. A tipagem mente; não confie nela para comparação estrita.

### 🔒 `getDuplicidade` interpola o nome da coluna

O padrão copiado entre módulos é:

```ts
`SELECT ${field} FROM tabela WHERE ${field} = ?`; // ← field vem do req.body
```

O **valor** é parametrizado; o **nome da coluna** não. Valide `field` contra lista fixa, e **exclua o próprio registro** — senão editar e salvar o mesmo cadastro acusa duplicidade do próprio CPF:

```ts
async getDuplicidade(field: string, value: string, id_motorista?: number) {
    if (!['cpf', 'cnh'].includes(field)) return [];

    const values: any[] = [value, this.conexao.id_empresa];

    let sql = `SELECT id_motorista FROM motorista
                WHERE ${field} = ? AND id_empresa = ? AND deletado = 'N'`;

    if (id_motorista) {                          // alteração: ignora a si mesmo
        sql += ` AND id_motorista <> ?`;
        values.push(id_motorista);
    }

    return this.conexao.queryParam(sql, values);
}
```

Combine com o front: ou ele pula a checagem no update, ou manda o id. Se não combinar, o cadastro fica impossível de salvar depois de editado.

O escopo do `getDuplicidade` também entra na decisão de tenant abaixo — `_template` filtra `id_empresa`, `cargos` e `transportadoras` não. Para cadastro por loja, isso decide se "CPF duplicado" é regra da loja ou do tenant inteiro.

Esses dois também não filtram `deletado`: registro excluído logicamente segue bloqueando um cadastro novo com o mesmo valor. Inclua `AND deletado = 'N'` se o soft delete deve liberar o valor.

---

## Auditoria (`SqlLogs`)

Opt-in por módulo. Grava em `logs` (`cod_funcionario, tela, log, id_empresa`). O campo `tela` sai sozinho de `usuario.url`, que o `per` preenche com a URL da requisição — não hardcode.

```ts
import SqlLogs from '../logs/sql.logs';

constructor(conexao: iConexao, private usuario: iUsuario) {
    this.sql = new Sql(conexao, this.usuario);
    this.sqlLog = new SqlLogs(conexao, this.usuario);
}

async update(id: number, param: any) {
    let rs = await this.sql.update(id, param.new);
    if (rs > 0)
        await this.sqlLog.insertLogNormatize(param.new, param.old);
    return { row: rs };
}
```

- `insertLogNormatize(_new, _old)` — UPDATE; gera `"antigo -> novo"` iterando as chaves de `_old`
- `insertLog(texto)` — INSERT/DELETE; texto livre

Sempre condicionado a `rs > 0` — por isso `update`/`delete` usam `executeParamCount`.

### ⚠️ Use `await` no log

Os módulos existentes chamam `insertLog` **sem `await`**, e o `per` fecha a conexão no `finally`. É corrida: o log pode ser disparado contra conexão já liberada. Em código novo, `await`.

---

## Defaults do Projeto (não precisa perguntar)

| Questão               | Default                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Paginação             | `LIMIT 30` fixo + `OFFSET`, sem total                                                                             |
| Soft ou hard delete   | Soft: `UPDATE ... SET deletado = 'S'`. Existe `'TRUE'/'FALSE'` em `transportadora` — **não copie**, use `'S'/'N'` |
| Mostrar inativos      | Só se a tela pedir; o padrão é um flag no body invertendo o filtro (ver `sql.cargos.ts`)                          |
| Insert devolve o quê  | `RETURNING id_<entidade>`                                                                                         |
| Validação de CPF/CNPJ | No front (`utils.validaCPF_CNPJ`); no back, só presença                                                           |
| Nome dos `call`       | `get<Entidades>`, `insert`, `update`, `delete`, `getDuplicidade`                                                  |
| Menu                  | Cadastro no banco `helper` + permissão em `menu_usuario`. **Não é código** — avise que falta                      |

**Pergunte antes de codar:** schema da tabela (colunas e tipos), se o cadastro é por loja ou do tenant, e se a tabela já existe em algum tenant legado.

### Se a tabela não existe

Convenções das migrations recentes:

```sql
CREATE TABLE IF NOT EXISTS motorista (
    id_motorista  serial       PRIMARY KEY,
    nome          varchar(60)  NOT NULL,
    deletado      varchar(1)   NOT NULL DEFAULT 'N',
    id_empresa    integer      NOT NULL DEFAULT 0,
    updated_at    timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Use `varchar`, não `char(n)` — é o `char(n)` legado (herdado do Firebird) que obriga `trim()` no SELECT. Tabela nova em `varchar` dispensa.

⚠️ `CREATE TABLE IF NOT EXISTS` vira **no-op silencioso** em tenant que já tenha uma tabela legada com esse nome e outro schema. Confira o schema real, não a lista de migrations aplicadas. Rode em um banco primeiro: `tsx src/migrate.ts up --db=<banco>`.

---

## Red Flags — PARE Aqui

| Pensamento                                                  | Ação                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| "Uso `res.send()` no método da Router"                      | **PARE.** `res` é `undefined`. Retorne o valor.                                         |
| "Pego `id_empresa` do `req.body`"                           | **PARE.** Vem do token, sempre.                                                         |
| "Passo `param.new` / `req.body.param` cru pro `prepareSql`" | **PARE.** Whitelist antes — mass assignment, nos dois (`insert` e `update`).            |
| "Whitelist pronta, segue o jogo"                            | Falta o guard: objeto vazio gera `SET` vazio e quebra em runtime.                       |
| "Uso `${field}` do body no SQL"                             | **PARE.** Valide contra lista fixa.                                                     |
| "Faço `DELETE FROM`"                                        | Confirme: o padrão é soft delete.                                                       |
| "Misturo `?` e `$N`"                                        | **PARE.** Lança erro em runtime.                                                        |
| "Escrevo `SET col1 = ?, col2 = ?` à mão"                    | Pode — mas **grave o aviso** (ver abaixo): o front terá que mandar o registro completo. |
| "Chamo `insertLog` sem `await`"                             | Corrida com o `close()` do `per`. Use `await`.                                          |
| "`CREATE TABLE IF NOT EXISTS` resolve"                      | Em tenant com tabela legada vira no-op silencioso. Confira o schema real.               |
| "Vou comentar o que esse método faz"                        | **PARE.** Só o POR QUÊ não-óbvio — o contrato abaixo é a exceção legítima.              |

### O contrato com o front precisa sobreviver ao turno

Quando o `update` da rota **não** usa `prepareSql.updateParam`, quem for fazer a tela precisa saber — e "avise o front" morre quando a conversa acaba. Grave onde dura: comentário no topo do `sql.<rota>.ts`.

```ts
// CONTRATO: update com SET fixo — o front deve mandar o registro COMPLETO em `param`.
// Mandar só o diff (getDiffTwoJson) zera as colunas não enviadas.
```

---

## Checklist

- [ ] `src/_ADMIN/<rota>/` com `route.`, `ctrl.`, `sql.`, `i.`, `.http`
- [ ] Import + `router.post('/<rota>', auth.authorize, route<Rota>)` em `adminRoute.ts`
- [ ] Métodos da Router recebem só `req` e **retornam** (nada de `res`)
- [ ] `id_sociedade` e `id_empresa` vindos do token
- [ ] SELECT, UPDATE, DELETE e `getDuplicidade` com a **mesma** decisão de tenant
- [ ] Whitelist antes do `updateParam` **e** do `insertParam`, com guard de objeto vazio
- [ ] `field` do `getDuplicidade` validado contra lista fixa, e o próprio id excluído
- [ ] Se o `update` tem `SET` fixo: contrato comentado no topo do `sql.<rota>.ts`
- [ ] Soft delete com `'S'/'N'`
- [ ] `await` nos logs, condicionados a `rs > 0`
- [ ] Migration criada e testada em **um** banco (`tsx src/migrate.ts up --db=<banco>`) antes de todos
- [ ] `.http` com um request por `call`
- [ ] Zero comentário explicando o QUÊ — só POR QUÊ não-óbvio
- [ ] Avisar: falta cadastrar no menu (banco `helper`)

---

## Referências

- **Template canônico:** [src/\_template/](../../../src/_template/)
- **Par no front:** `erp_admin_v2/src/pages/_Template/` — mesma entidade; para criar a tela, use a skill `padrao-projeto-wayap` lá
- **Despacho:** [src/services/per.controllers.ts](../../../src/services/per.controllers.ts)
- **SQL dinâmico:** [src/db/prepareSql.ts](../../../src/db/prepareSql.ts) · **Conexão/placeholders:** [src/db/postgresConnect.ts](../../../src/db/postgresConnect.ts)
- **Auditoria:** [src/\_ADMIN/logs/sql.logs.ts](../../../src/_ADMIN/logs/sql.logs.ts)
- **Migrations:** [src/migrations/README.md](../../../src/migrations/README.md)
