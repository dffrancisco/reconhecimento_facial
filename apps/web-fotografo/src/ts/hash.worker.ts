import { sha256EmFatias } from "./hash";

self.onmessage = async (evento: MessageEvent<{ id: number; arquivo: File }>) => {
    const { id, arquivo } = evento.data;
    try {
        self.postMessage({ id, hash: await sha256EmFatias(arquivo) });
    } catch (erro) {
        self.postMessage({ id, erro: erro instanceof Error ? erro.message : String(erro) });
    }
};
