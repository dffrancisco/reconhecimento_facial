import fs from "node:fs/promises";
import path from "node:path";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { DadosPublicarFoto } from "./i.foto";
import { situacaoAtual, substituirRostos, upsertFoto } from "./sql.foto";

export interface ArquivosPublicarFoto {
    web: Buffer;
    thumb: Buffer;
    previa: Buffer;
}

export default class FotoCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async publicarFoto(dados: DadosPublicarFoto, arquivos: ArquivosPublicarFoto): Promise<{ ok: true }> {
        // Foto excluída não ressuscita: a estação não sabe que foi apagada até sincronizar de novo.
        if ((await situacaoAtual(this.conexao, dados.id_evento, dados.hash_arquivo)) === "excluida") return { ok: true };

        // `init()` já abriu a transação (openTransaction). Se qualquer passo falhar — banco ou
        // disco — marcarErro() garante que o close() do route.foto.ts faça ROLLBACK em vez de
        // COMMIT, para nunca publicar a linha sem os arquivos (ou vice-versa).
        try {
            const idFoto = await upsertFoto(this.conexao, dados);
            await substituirRostos(this.conexao, idFoto, dados.id_evento, dados.rostos);

            const pasta = path.join(config.raizFotos, String(dados.id_evento));
            await fs.mkdir(pasta, { recursive: true });
            await Promise.all([
                fs.writeFile(path.join(pasta, `${dados.hash_arquivo}_web.jpg`), arquivos.web),
                fs.writeFile(path.join(pasta, `${dados.hash_arquivo}_thumb.jpg`), arquivos.thumb),
                fs.writeFile(path.join(pasta, `${dados.hash_arquivo}_previa.jpg`), arquivos.previa),
            ]);
        } catch (erro) {
            this.conexao.marcarErro();
            throw erro;
        }
        return { ok: true };
    }
}
