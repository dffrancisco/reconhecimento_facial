import { FalhaDeEnvio, type ItemFila, type ServicosFila } from "./tipos";

const TENTATIVAS_POR_FOTO = 6;
const REENVIOS_POR_HASH = 1;
const ESPERA_INICIAL_MS = 1000;
const ESPERA_MAXIMA_MS = 32_000;

const espera = (vezes: number) => Math.min(ESPERA_INICIAL_MS * 2 ** vezes, ESPERA_MAXIMA_MS);

export interface EstadoFila {
    itens: ItemFila[];
    pausada: boolean;
    semConexaoDesde: number | null;
    parada: string | null;
    enviados: number;
    pulados: number;
    esperando: number;
    comErro: number;
    bytesTotais: number;
    bytesEnviados: number;
}

// Sem Vue e com os serviços recebidos de fora: é o que permite provar os três tipos de falha
// (spec §4.2) sem navegador e sem rede. A tela só assina o estado.
export class FilaDeEnvio {
    private itens: ItemFila[] = [];
    private ativos = 0;
    private pausada = false;
    private parada: string | null = null;
    private semConexaoDesde: number | null = null;
    private falhasDeConexaoSeguidas = 0;
    private ouvintes = new Set<() => void>();
    private _porVez: number;
    private agora: () => number;

    constructor(
        private servicos: ServicosFila,
        private opcoes: { pedacoBytes: number; porVez?: number; agora?: () => number }
    ) {
        this._porVez = opcoes.porVez ?? 3;
        this.agora = opcoes.agora ?? Date.now;
    }

    get porVez(): number {
        return this._porVez;
    }

    set porVez(valor: number) {
        this._porVez = Math.min(6, Math.max(1, Math.round(valor)));
        this.avisar();
        this.bombear();
    }

    adicionar(novos: { chave: string; arquivo: File; hash?: string }[]): void {
        const conhecidas = new Set(this.itens.map((i) => i.chave));
        for (const { chave, arquivo, hash } of novos) {
            if (conhecidas.has(chave)) continue;
            conhecidas.add(chave);
            this.itens.push({
                chave,
                arquivo,
                nome: arquivo.name,
                tamanho: arquivo.size,
                situacao: "esperando",
                progresso: 0,
                hash,
                tentativas: 0,
                reenviosPorHash: 0,
            });
        }
        this.avisar();
        this.bombear();
    }

    iniciar(): void {
        this.bombear();
    }

    pausar(): void {
        this.pausada = true;
        this.avisar();
    }

    continuar(): void {
        this.pausada = false;
        this.parada = null;
        this.avisar();
        this.bombear();
    }

    tentarDeNovo(chave: string): void {
        const item = this.itens.find((i) => i.chave === chave);
        if (!item || item.situacao !== "erro") return;
        Object.assign(item, { situacao: "esperando", tentativas: 0, reenviosPorHash: 0, mensagem: undefined });
        this.mudou(item);
        this.bombear();
    }

    assinar(ouvinte: () => void): () => void {
        this.ouvintes.add(ouvinte);
        return () => this.ouvintes.delete(ouvinte);
    }

    estado(): EstadoFila {
        const conta = (...s: ItemFila["situacao"][]) => this.itens.filter((i) => s.includes(i.situacao)).length;
        let bytesEnviados = 0;
        let bytesTotais = 0;
        for (const item of this.itens) {
            if (item.situacao === "erro") continue;
            bytesTotais += item.tamanho;
            bytesEnviados += item.situacao === "enviado" || item.situacao === "pulado" ? item.tamanho : item.progresso * item.tamanho;
        }
        return {
            itens: this.itens,
            pausada: this.pausada,
            semConexaoDesde: this.semConexaoDesde,
            parada: this.parada,
            enviados: conta("enviado"),
            pulados: conta("pulado"),
            esperando: conta("esperando", "preparando", "enviando"),
            comErro: conta("erro"),
            bytesTotais,
            bytesEnviados,
        };
    }

    private avisar(): void {
        for (const ouvinte of this.ouvintes) ouvinte();
    }

    private mudou(item: ItemFila): void {
        this.servicos.aoMudar?.(item);
        this.avisar();
    }

    private podeSeguir(): boolean {
        return !this.pausada && this.parada === null;
    }

    // Ocupa as vagas livres com os próximos da fila. O hash só é calculado quando a foto
    // ganha uma vaga: numa pasta de 2 000 fotos, calcular tudo antes travaria o começo.
    private bombear(): void {
        while (this.podeSeguir() && this.ativos < this._porVez) {
            const item = this.itens.find((i) => i.situacao === "esperando");
            if (!item) return;
            this.ativos++;
            item.situacao = "preparando";
            this.mudou(item);
            this.processar(item).finally(() => {
                this.ativos--;
                this.bombear();
            });
        }
    }

    private conectou(): void {
        this.falhasDeConexaoSeguidas = 0;
        if (this.semConexaoDesde !== null) {
            this.semConexaoDesde = null;
            this.avisar();
        }
    }

    private async processar(item: ItemFila): Promise<void> {
        if (!item.hash) {
            try {
                item.hash = await this.servicos.calcularHash(item.arquivo);
            } catch {
                this.falhar(item, "Não conseguimos ler este arquivo no computador.");
                return;
            }
            this.mudou(item);
        }

        for (;;) {
            if (!this.podeSeguir()) return this.voltarParaFila(item);
            try {
                if (await this.enviar(item)) return;
                return this.voltarParaFila(item);
            } catch (erro) {
                const falha = erro instanceof FalhaDeEnvio ? erro : new FalhaDeEnvio("foto", "Não conseguimos enviar esta foto.");

                if (falha.tipo === "sem_conexao") {
                    // Wi-Fi de evento cai: não é erro da foto. Espera e tenta de novo, para sempre.
                    if (this.semConexaoDesde === null) this.semConexaoDesde = this.agora();
                    this.avisar();
                    await this.servicos.esperar(espera(this.falhasDeConexaoSeguidas++));
                    continue;
                }
                if (falha.tipo === "estacao") {
                    // Link fechado, evento encerrado ou disco cheio valem para todas as fotos:
                    // gastar 6 tentativas em cada uma só adiaria a mesma mensagem.
                    this.parada = falha.message;
                    return this.voltarParaFila(item);
                }
                if (falha.tipo === "hash_diferente" && item.reenviosPorHash < REENVIOS_POR_HASH) {
                    item.reenviosPorHash++;
                    item.progresso = 0;
                    this.mudou(item);
                    continue;
                }
                if (falha.tipo === "hash_diferente") return this.falhar(item, falha.message);

                item.tentativas++;
                if (item.tentativas >= TENTATIVAS_POR_FOTO) return this.falhar(item, falha.message);
                await this.servicos.esperar(espera(item.tentativas - 1));
            }
        }
    }

    // Devolve `true` quando a foto terminou (enviada ou pulada) e `false` quando parou por
    // pausa ou parada, para voltar à fila e retomar de onde a estação disser.
    private async enviar(item: ItemFila): Promise<boolean> {
        const inicio = await this.servicos.iniciar({ nome_arquivo: item.nome, tamanho: item.tamanho, hash_arquivo: item.hash! });
        this.conectou();
        if (inicio.situacao === "ja_existe") {
            Object.assign(item, { situacao: "pulado", progresso: 1 });
            this.mudou(item);
            return true;
        }

        item.idUpload = inicio.id_upload;
        item.situacao = "enviando";
        let offset = inicio.bytes_recebidos;
        item.progresso = offset / item.tamanho;
        this.mudou(item);

        // Pelo menos um pedaço, mesmo vazio: a estação que já tem o arquivo inteiro (caiu antes
        // de conferir) só conclui quando recebe um pedaço no fim.
        for (;;) {
            if (!this.podeSeguir()) return false;
            const pedaco = item.arquivo.slice(offset, offset + this.opcoes.pedacoBytes);
            const base = offset;
            let resposta: { bytes_recebidos: number; completo: boolean };
            try {
                resposta = await this.servicos.enviarPedaco({
                    idUpload: inicio.id_upload,
                    offset,
                    pedaco,
                    aoProgredir: (bytes) => {
                        item.progresso = Math.min(1, (base + bytes) / item.tamanho);
                        this.avisar();
                    },
                });
            } catch (erro) {
                if (erro instanceof FalhaDeEnvio && erro.tipo === "fora_de_ordem" && erro.bytesRecebidos !== undefined) {
                    offset = erro.bytesRecebidos;
                    continue;
                }
                throw erro;
            }
            this.conectou();
            offset = resposta.bytes_recebidos;
            item.progresso = Math.min(1, offset / item.tamanho);
            if (resposta.completo) {
                item.situacao = "enviado";
                this.mudou(item);
                return true;
            }
            if (offset >= item.tamanho) throw new FalhaDeEnvio("foto", "A estação não concluiu o recebimento.");
            this.mudou(item);
        }
    }

    private voltarParaFila(item: ItemFila): void {
        item.situacao = "esperando";
        this.mudou(item);
    }

    private falhar(item: ItemFila, mensagem: string): void {
        Object.assign(item, { situacao: "erro", mensagem });
        this.mudou(item);
    }
}
