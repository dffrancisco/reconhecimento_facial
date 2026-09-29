import { chamarMultipart } from "./api";
import { chaveDoAparelho } from "./aparelho";

export const VERSAO_TERMO = "v1";

export interface EntradaBusca {
    slug?: string;
    chaveAcesso?: string;
    versaoTermo: string;
    selfies: File[];
    // Token da busca anterior no "buscar de novo": é ele que dispensa refazer a verificação
    // quando ela existir (spec da plataforma §8).
    tokenOrigem?: string;
}

export interface RespostaBusca {
    token: string;
    status: "aguardando" | "liberada";
    qtd_fotos: number;
    previas: string[];
    codigo?: string;
}

export async function buscarPorSelfie(entrada: EntradaBusca): Promise<RespostaBusca> {
    const forma = new FormData();
    forma.append("call", "buscar");
    if (entrada.chaveAcesso) forma.append("chave_acesso", entrada.chaveAcesso);
    else if (entrada.slug) forma.append("slug", entrada.slug);
    forma.append("versao_termo", entrada.versaoTermo);
    // O visto de marketing só existe na tela de verificação, que é da parte 2: até lá,
    // ninguém entra em lista de marketing (spec do app, §5).
    forma.append("aceita_marketing", "N");
    if (entrada.tokenOrigem) forma.append("token_origem", entrada.tokenOrigem);
    const chave = chaveDoAparelho();
    if (chave) forma.append("chave_aparelho", chave);
    for (const selfie of entrada.selfies) forma.append("selfies", selfie, selfie.name);

    return chamarMultipart<RespostaBusca>("participante", "busca", forma);
}
