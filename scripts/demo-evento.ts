// Demonstração de ponta a ponta, do jeito que um evento acontece de verdade:
// cria o evento no admin, manda as fotos pela estação, espera a publicação na VPS e
// faz a busca por selfie. Serve para ver a plataforma inteira funcionando sem frontend.
//
// Uso: npm run demo-evento -- --fotos <pasta com as fotos> --selfie <sua selfie.jpg>
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executar = promisify(execFile);
const RAIZ = path.resolve(__dirname, "..");

const VPS = argumento("api", "http://127.0.0.1:3002") as string;
const ARQUIVOS = argumento("arquivos", "http://127.0.0.1:8080") as string;
const LOGIN = argumento("login", "ana") as string;
const SENHA = argumento("senha", "senha-dev-123") as string;

function argumento(nome: string, padrao?: string): string | undefined {
    const idx = process.argv.indexOf(`--${nome}`);
    return idx >= 0 ? process.argv[idx + 1] : padrao;
}

function passo(texto: string): void {
    console.log(`\n\u001b[1m${texto}\u001b[0m`);
}

async function chamar(area: string, modulo: string, corpo: object, token?: string): Promise<Record<string, unknown>> {
    const resposta = await fetch(`${VPS}/api/${area}/${modulo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
        body: JSON.stringify(corpo),
    });
    const dados = (await resposta.json()) as Record<string, unknown>;
    if (!resposta.ok) throw new Error(`${area}/${modulo} respondeu ${resposta.status}: ${dados.msg ?? JSON.stringify(dados)}`);
    if (dados.error) throw new Error(`${area}/${modulo}: ${dados.msg}`);
    return dados;
}

async function compose(...args: string[]): Promise<string> {
    const { stdout } = await executar("docker", ["compose", "-f", path.join(RAIZ, "docker-compose.dev.yml"), ...args], { cwd: RAIZ });
    return stdout.trim();
}

async function sql(banco: string, consulta: string): Promise<string> {
    const { stdout } = await executar("docker", ["exec", "fotos-dev-postgres-1", "psql", "-U", "fotos", "-d", banco, "-tAc", consulta]);
    return stdout.trim();
}

async function esperar<T>(descricao: string, tentativas: number, intervaloMs: number, condicao: () => Promise<T | undefined>): Promise<T> {
    for (let i = 0; i < tentativas; i++) {
        const valor = await condicao();
        if (valor !== undefined) return valor;
        process.stdout.write(`\r  ${descricao}... ${i * (intervaloMs / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, intervaloMs));
    }
    throw new Error(`tempo esgotado: ${descricao}`);
}

async function main(): Promise<void> {
    const pastaFotos = argumento("fotos");
    const selfie = argumento("selfie");
    if (!pastaFotos || !selfie) {
        console.error("Uso: npm run demo-evento -- --fotos <pasta com as fotos do evento> --selfie <sua selfie.jpg>");
        process.exit(1);
    }

    const jpegs = (await fs.readdir(pastaFotos)).filter((n) => /\.jpe?g$/i.test(n));
    if (jpegs.length === 0) throw new Error(`nenhum JPEG em ${pastaFotos}`);
    await fs.access(selfie);

    passo(`1/6  Copiando ${jpegs.length} foto(s) para onde a estação enxerga`);
    // A estação só lê o que está em dados/ (montado no container como /data/dados).
    const nomePasta = `demo-${Date.now()}`;
    const destino = path.join(RAIZ, "dados", nomePasta);
    await fs.mkdir(destino, { recursive: true });
    for (const nome of jpegs) await fs.copyFile(path.join(pastaFotos, nome), path.join(destino, nome));
    console.log(`  dados/${nomePasta}/`);

    passo("2/6  Criando o evento no admin da VPS");
    const login = await chamar("admin", "login", { call: "login", login: LOGIN, senha: SENHA });
    const token = String(login.token);
    const slug = `demo-${Date.now()}`;
    const evento = await chamar(
        "admin",
        "evento",
        { call: "criarEvento", nome: "Evento de demonstração", slug, tipo: "social", data_fim: "2027-12-31" },
        token
    );
    const idEvento = Number(evento.id_evento);
    // Evento social nasce privado (spec §5): aí o participante entra pela chave de acesso,
    // nunca pelo slug. O link que ele recebe é /#/p/<chave_acesso>.
    const privado = evento.privado === "S";
    const comoEntrar = privado ? { chave_acesso: String(evento.chave_acesso) } : { slug };
    // Sem WhatsApp a busca já libera o resultado — a verificação é a parte 2 da fase 4.
    await chamar("admin", "evento", { call: "editarEvento", id_evento: idEvento, config: { exigir_whatsapp: false } }, token);
    console.log(`  evento ${idEvento} (${slug})${privado ? ", privado — acesso por chave" : ", público — acesso pelo slug"}`);
    console.log(`  chave do anfitrião: ${evento.chave_anfitriao}`);

    passo("3/6  Esperando a estação sincronizar o evento (roda a cada 60s)");
    await compose("start", "worker-estacao");
    await esperar("sincronizando", 40, 3000, async () =>
        (await sql("fotos_estacao", `SELECT 1 FROM evento WHERE id_evento = ${idEvento}`)) === "1" ? true : undefined
    );
    console.log("\r  evento chegou na estação            ");

    passo(`4/6  Ingerindo as fotos pela estação`);
    await compose("exec", "-T", "worker-estacao", "node", "dist/scripts/ingerir.js", "--evento", slug, "--pasta", `/data/dados/${nomePasta}`);

    passo("5/6  Processando (rostos na GPU) e publicando na VPS");
    const publicadas = await esperar("processando", 120, 2000, async () => {
        const n = Number(await sql("fotos_vps", `SELECT count(*) FROM foto WHERE id_evento = ${idEvento}`));
        return n >= jpegs.length ? n : undefined;
    });
    const rostos = await sql("fotos_vps", `SELECT coalesce(sum(qtd_rostos), 0) FROM foto WHERE id_evento = ${idEvento}`);
    console.log(`\r  ${publicadas} foto(s) publicada(s), ${rostos} rosto(s) reconhecido(s)        `);

    passo("6/6  Buscando pela sua selfie");
    const forma = new FormData();
    forma.append("call", "buscar");
    for (const [campo, valor] of Object.entries(comoEntrar)) forma.append(campo, valor);
    forma.append("versao_termo", "v1");
    forma.append("aceita_marketing", "N");
    const tipo = selfie.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    forma.append("selfies", new Blob([await fs.readFile(selfie)], { type: tipo }), path.basename(selfie));

    const rBusca = await fetch(`${VPS}/api/participante/busca`, { method: "POST", body: forma });
    const busca = (await rBusca.json()) as { token?: string; status?: string; qtd_fotos?: number; msg?: string };
    if (!rBusca.ok || !busca.token) throw new Error(`a busca falhou: ${busca.msg}`);

    console.log(`  ${busca.qtd_fotos} foto(s) sua(s) encontrada(s) de ${publicadas}`);

    const resultado = (await chamar("participante", "resultado", { call: "getResultado", token: busca.token })) as unknown as {
        fotos: { id_foto: number; thumb: string; similaridade: number }[];
    };

    console.log("\n\u001b[1mAbra no navegador:\u001b[0m");
    for (const foto of resultado.fotos.slice(0, 5))
        console.log(`  ${(foto.similaridade * 100).toFixed(1)}% parecido: ${ARQUIVOS}${foto.thumb}`);
    if (resultado.fotos.length > 5) console.log(`  ... e mais ${resultado.fotos.length - 5}`);

    if (resultado.fotos.length > 0) {
        const links = (await chamar("participante", "resultado", {
            call: "gerarLinks",
            token: busca.token,
            ids: resultado.fotos.map((f) => f.id_foto),
        })) as unknown as { links: { url: string }[] };
        console.log(`\n\u001b[1mBaixar em tamanho grande:\u001b[0m\n  ${ARQUIVOS}${links.links[0].url}`);

        const zip = (await chamar("participante", "resultado", { call: "pedirZip", token: busca.token })) as unknown as {
            partes: number[];
        };
        const url = await esperar("montando o ZIP", 60, 1000, async () => {
            const situacao = (await chamar("participante", "resultado", {
                call: "situacaoZip",
                token: busca.token,
                id_arquivo_zip: zip.partes[0],
            })) as { status: string; url?: string };
            return situacao.status === "pronto" ? situacao.url : undefined;
        });
        console.log(`\r\u001b[1mBaixar todas em ZIP:\u001b[0m\n  ${ARQUIVOS}${url}        `);
    }

    console.log(`\n\u001b[1mGaleria do anfitrião\u001b[0m (vê o evento inteiro, sem selfie):`);
    console.log(`  chave: ${evento.chave_anfitriao}`);
    console.log(`  npm run demo-galeria -- --chave ${evento.chave_anfitriao}`);
}

main().catch((erro) => {
    console.error("\n[DemoEvento] Falhou:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
});
