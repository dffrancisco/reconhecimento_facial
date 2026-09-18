export type tPapel = "estacao" | "vps";
export type tAlvo = tPapel | "ambos";

export interface iMigracao {
    up: string;
    down: string;
    semTransacao: boolean;
    alvo: tAlvo;
}

const ALVOS: tAlvo[] = ["estacao", "vps", "ambos"];

export function interpretarMigracao(conteudo: string, nomeArquivo: string): iMigracao {
    let secao: "nenhuma" | "up" | "down" = "nenhuma";
    const up: string[] = [];
    const down: string[] = [];
    let semTransacao = false;
    let alvo: tAlvo | undefined;

    for (const linha of conteudo.split(/\r?\n/)) {
        const marcador = linha.trim().toLowerCase();

        if (marcador === "-- migrate:up") {
            secao = "up";
            continue;
        }
        if (marcador === "-- migrate:down") {
            secao = "down";
            continue;
        }
        if (marcador === "-- migrate:no-transaction") {
            semTransacao = true;
            continue;
        }
        if (marcador.startsWith("-- migrate:target")) {
            const valor = marcador.replace("-- migrate:target", "").trim();
            if (!ALVOS.includes(valor as tAlvo))
                throw new Error(
                    `Diretiva "-- migrate:target ${valor}" inválida em ${nomeArquivo}. Use: ${ALVOS.join(", ")}`
                );
            alvo = valor as tAlvo;
            continue;
        }

        if (secao === "up") up.push(linha);
        else if (secao === "down") down.push(linha);
    }

    if (!alvo) throw new Error(`Migração sem "-- migrate:target" em ${nomeArquivo}`);

    const upSql = up.join("\n").trim();
    if (!upSql) throw new Error(`Migração sem seção "-- migrate:up" (ou vazia): ${nomeArquivo}`);

    return { up: upSql, down: down.join("\n").trim(), semTransacao, alvo };
}

export function deveRodar(alvo: tAlvo, papel: tPapel): boolean {
    return alvo === "ambos" || alvo === papel;
}

export function nomeDeMigracaoValido(nome: string): boolean {
    return /^\d{14}_[a-z0-9_]+\.sql$/.test(nome);
}
