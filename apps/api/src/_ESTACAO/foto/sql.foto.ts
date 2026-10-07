import ConexaoPostgres from "../../db/conexaoPostgres";
import { DadosPublicarFoto } from "./i.foto";

export async function situacaoAtual(conexao: ConexaoPostgres, idEvento: number, hash: string): Promise<string | undefined> {
    const linha = await conexao.queryOneParam<{ situacao: string }>("SELECT situacao FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [
        idEvento,
        hash,
    ]);
    return linha?.situacao;
}

export async function eventoExiste(conexao: ConexaoPostgres, idEvento: number): Promise<boolean> {
    return !!(await conexao.queryOneParam("SELECT 1 FROM evento WHERE id_evento = ?", [idEvento]));
}

export async function upsertFoto(conexao: ConexaoPostgres, dados: DadosPublicarFoto): Promise<number> {
    const [linha] = await conexao.queryParam<{ id_foto: number }>(
        `INSERT INTO foto (id_evento, id_evento_fotografo, hash_arquivo, largura, altura, bytes_web, capturada_em, camera, qtd_rostos, publicada_em, situacao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now(), 'visivel')
         ON CONFLICT (id_evento, hash_arquivo) DO UPDATE SET
             id_evento_fotografo = EXCLUDED.id_evento_fotografo, largura = EXCLUDED.largura, altura = EXCLUDED.altura,
             bytes_web = EXCLUDED.bytes_web, capturada_em = EXCLUDED.capturada_em, camera = EXCLUDED.camera,
             qtd_rostos = EXCLUDED.qtd_rostos, publicada_em = now()
         RETURNING id_foto`,
        [dados.id_evento, dados.id_evento_fotografo, dados.hash_arquivo, dados.largura, dados.altura, dados.bytes_web, dados.capturada_em, dados.camera, dados.rostos.length]
    );
    return linha.id_foto;
}

export async function substituirRostos(conexao: ConexaoPostgres, idFoto: number, idEvento: number, rostos: DadosPublicarFoto["rostos"]): Promise<void> {
    await conexao.executeParamCount("DELETE FROM rosto WHERE id_foto = ?", [idFoto]);
    for (const rosto of rostos) {
        await conexao.executeParamCount("INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, ?, ?, ?)", [
            idFoto,
            idEvento,
            `[${rosto.embedding.join(",")}]`,
            JSON.stringify(rosto.bbox),
            rosto.det_score,
            rosto.area_px,
        ]);
    }
}
