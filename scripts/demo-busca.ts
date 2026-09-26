import fs from "node:fs/promises";
import path from "node:path";

function argumento(nome: string, padrao?: string): string | undefined {
    const idx = process.argv.indexOf(`--${nome}`);
    return idx >= 0 ? process.argv[idx + 1] : padrao;
}

async function main(): Promise<void> {
    const slug = argumento("evento");
    const selfie = argumento("selfie");
    const base = argumento("api", "http://127.0.0.1:3002") as string;
    const arquivos = argumento("arquivos", "http://127.0.0.1:8080") as string;
    if (!slug || !selfie) throw new Error("Uso: npm run demo-busca -- --evento <slug> --selfie <arquivo.jpg>");

    const forma = new FormData();
    forma.append("call", "buscar");
    forma.append("slug", slug);
    forma.append("versao_termo", "v1");
    forma.append("aceita_marketing", "N");
    forma.append("selfies", new Blob([await fs.readFile(selfie)]), path.basename(selfie));

    const resposta = await fetch(`${base}/api/participante/busca`, { method: "POST", body: forma });
    const busca = (await resposta.json()) as { token?: string; status?: string; qtd_fotos?: number; msg?: string };
    if (!resposta.ok) throw new Error(`busca falhou (${resposta.status}): ${busca.msg}`);

    console.log(`Busca ${busca.status} — ${busca.qtd_fotos} foto(s) encontradas.`);
    if (busca.status !== "liberada") {
        console.log("Evento exige verificação: o código sai pelo WhatsApp (parte 2 da fase 4).");
        return;
    }

    const rResultado = await fetch(`${base}/api/participante/resultado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call: "getResultado", token: busca.token }),
    });
    const resultado = (await rResultado.json()) as { fotos: { id_foto: number; thumb: string; similaridade: number }[] };
    console.log(`Resultado: ${resultado.fotos.length} foto(s).`);

    // Baixa o primeiro thumb pelo nginx: prova que o link assinado vale de verdade.
    if (resultado.fotos.length > 0) {
        const thumb = await fetch(arquivos + resultado.fotos[0].thumb);
        console.log(
            `Primeiro thumb: HTTP ${thumb.status}, ${(await thumb.arrayBuffer()).byteLength} bytes, similaridade ${resultado.fotos[0].similaridade.toFixed(3)}`
        );

        const rLinks = await fetch(`${base}/api/participante/resultado`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ call: "gerarLinks", token: busca.token, ids: [resultado.fotos[0].id_foto] }),
        });
        const links = (await rLinks.json()) as { links: { url: string }[] };
        const download = await fetch(arquivos + links.links[0].url);
        console.log(`Download: HTTP ${download.status}, Content-Disposition: ${download.headers.get("content-disposition")}`);

        const rZip = await fetch(`${base}/api/participante/resultado`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ call: "pedirZip", token: busca.token }),
        });
        const zip = (await rZip.json()) as { id_arquivo_zip: number };
        console.log(`ZIP pedido: arquivo ${zip.id_arquivo_zip} (o worker da VPS monta em segundos).`);
    }
}

main().catch((erro) => {
    console.error("[DemoBusca] Falhou:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
});
