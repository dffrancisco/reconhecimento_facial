// Galeria do anfitrião: quem tem a chave vê o evento inteiro, sem selfie e sem verificação.
// Uso: npm run demo-galeria -- --chave <chave_anfitriao>
function argumento(nome: string, padrao?: string): string | undefined {
    const idx = process.argv.indexOf(`--${nome}`);
    return idx >= 0 ? process.argv[idx + 1] : padrao;
}

async function main(): Promise<void> {
    const chave = argumento("chave");
    const base = argumento("api", "http://127.0.0.1:3002") as string;
    const arquivos = argumento("arquivos", "http://127.0.0.1:8080") as string;
    if (!chave) throw new Error("Uso: npm run demo-galeria -- --chave <chave_anfitriao>");

    const resposta = await fetch(`${base}/api/anfitriao/galeria`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call: "getGaleria", chave, offset: 0 }),
    });
    const galeria = (await resposta.json()) as { evento?: string; fotos?: { thumb: string }[]; msg?: string };
    if (!resposta.ok) throw new Error(`a galeria falhou: ${galeria.msg}`);

    console.log(`\nEvento: ${galeria.evento} — ${galeria.fotos?.length ?? 0} foto(s) nesta página\n`);
    for (const foto of (galeria.fotos ?? []).slice(0, 10)) console.log(`  ${arquivos}${foto.thumb}`);
}

main().catch((erro) => {
    console.error("[DemoGaleria] Falhou:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
});
