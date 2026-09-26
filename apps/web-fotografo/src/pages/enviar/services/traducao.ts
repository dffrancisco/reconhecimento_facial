import { ErroDaApi } from "../../../ts/erros";
import { FalhaDeEnvio } from "../../../ts/fila/tipos";

const PARA_TUDO = new Set(["link_invalido", "evento_encerrado", "sem_espaco"]);
const LINK_FECHADO = new Set(["link_invalido", "evento_encerrado"]);

function paraTudo(mensagem: string, codigo: string): FalhaDeEnvio {
    const falha = new FalhaDeEnvio("estacao", mensagem);
    falha.linkFechado = LINK_FECHADO.has(codigo);
    return falha;
}

// A fila decide pelo tipo, a tela mostra a mensagem: aqui é onde a resposta HTTP da estação
// vira uma coisa e outra. Sempre pelo `codigo`, nunca pelo texto.
export function falhaDoPedaco(status: number, corpo: unknown): FalhaDeEnvio {
    if (!status) return new FalhaDeEnvio("sem_conexao", "Sem conexão com a estação.");

    const c = (typeof corpo === "object" && corpo !== null ? corpo : {}) as { msg?: unknown; codigo?: unknown; bytes_recebidos?: unknown };
    const mensagem = typeof c.msg === "string" && c.msg ? c.msg : `A estação recusou o envio (código ${status}).`;
    const codigo = typeof c.codigo === "string" ? c.codigo : undefined;

    if (status === 409 && typeof c.bytes_recebidos === "number") return new FalhaDeEnvio("fora_de_ordem", mensagem, c.bytes_recebidos);
    if (codigo && PARA_TUDO.has(codigo)) return paraTudo(mensagem, codigo);
    if (codigo === "hash_diferente") return new FalhaDeEnvio("hash_diferente", mensagem);
    if (codigo === "nao_e_jpeg") return new FalhaDeEnvio("recusada", mensagem);
    return new FalhaDeEnvio("foto", mensagem);
}

export function falhaDaChamada(erro: unknown): FalhaDeEnvio {
    const e = erro instanceof ErroDaApi ? erro : new ErroDaApi("Não conseguimos completar. Tente de novo.");
    if (e.semConexao) return new FalhaDeEnvio("sem_conexao", e.message);
    if (e.codigo && PARA_TUDO.has(e.codigo)) return paraTudo(e.message, e.codigo);
    // 422 sem código no início é a validação (extensão, tamanho, hash): repetir não muda nada.
    if (e.status === 422) return new FalhaDeEnvio("recusada", e.message);
    return new FalhaDeEnvio("foto", e.message);
}
