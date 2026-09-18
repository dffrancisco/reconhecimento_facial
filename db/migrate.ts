import "./loadEnv";
import path from "node:path";
import { Client } from "pg";
import { aplicarPendentes, criarArquivo, listarMigracoes, reverterUltima, situacao } from "./migrador";
import { tAlvo, tPapel } from "./migrateParse";

const DIR = path.join(__dirname, "migrations");

const AJUDA = `Uso:
  npm run migrate -- create <nome> --target=estacao|vps|ambos
  npm run migrate -- up | down | status

O papel e o banco vêm de PAPEL e POSTGRES_HOST/PORT/USER/PASSWORD/DB.`;

function opcao(nome: string): string | undefined {
    return process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1];
}

function lerPapel(): tPapel {
    const papel = process.env.PAPEL;
    if (papel !== "estacao" && papel !== "vps")
        throw new Error(`PAPEL deve ser "estacao" ou "vps" (recebido: "${papel ?? ""}")`);
    return papel;
}

function novoClient(papel: tPapel): Client {
    const faltando = ["POSTGRES_HOST", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"].filter(
        (nome) => !process.env[nome]
    );
    if (faltando.length) throw new Error(`Variáveis faltando: ${faltando.join(", ")}`);

    return new Client({
        host: process.env.POSTGRES_HOST,
        port: Number(process.env.POSTGRES_PORT || 5432),
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB,
        application_name: `fotos-migrate:${papel}`,
    });
}

async function main(): Promise<void> {
    const comando = process.argv[2];

    if (comando === "create") {
        const alvo = opcao("target");
        if (alvo !== "estacao" && alvo !== "vps" && alvo !== "ambos")
            throw new Error("Informe --target=estacao, --target=vps ou --target=ambos");
        const arquivo = criarArquivo(DIR, process.argv[3] ?? "", alvo as tAlvo);
        console.log(`[Migrate] Criada: db/migrations/${arquivo}`);
        return;
    }

    if (comando !== "up" && comando !== "down" && comando !== "status") {
        console.log(AJUDA);
        process.exitCode = 1;
        return;
    }

    const papel = lerPapel();
    const arquivos = listarMigracoes(DIR);
    const client = novoClient(papel);
    await client.connect();
    console.log(`[Migrate] Banco ${process.env.POSTGRES_DB}, papel ${papel}`);

    try {
        if (comando === "up") {
            const feitas = await aplicarPendentes(client, arquivos, papel);
            if (!feitas.length) console.log("[Migrate] Nada pendente");
            for (const versao of feitas) console.log(`[Migrate] ✓ aplicada ${versao}`);
        } else if (comando === "down") {
            const versao = await reverterUltima(client, arquivos, papel);
            console.log(versao ? `[Migrate] ✓ revertida ${versao}` : "[Migrate] Nada para reverter");
        } else {
            for (const item of await situacao(client, arquivos, papel))
                console.log(`[Migrate] [${item.aplicada ? "✓" : " "}] ${item.versao}`);
        }
    } finally {
        await client.end();
    }
}

main().catch((erro) => {
    console.error(`[Migrate] ${(erro as Error).message}`);
    process.exit(1);
});
