import { Client } from "pg";

export function conexaoTeste(database: string): Client {
    return new Client({
        host: process.env.POSTGRES_HOST ?? "127.0.0.1",
        port: Number(process.env.POSTGRES_PORT ?? 5433),
        user: process.env.POSTGRES_USER ?? "fotos",
        password: process.env.POSTGRES_PASSWORD ?? "fotos",
        database,
    });
}

export async function criarBancoTeste(): Promise<{ client: Client; remover(): Promise<void> }> {
    const nome = `fotos_teste_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = conexaoTeste("postgres");
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nome}`);

    const client = conexaoTeste(nome);
    await client.connect();

    return {
        client,
        async remover() {
            await client.end();
            await admin.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
            await admin.end();
        },
    };
}

export async function tabelas(client: Client): Promise<string[]> {
    const { rows } = await client.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    return rows.map((r) => r.tablename);
}
