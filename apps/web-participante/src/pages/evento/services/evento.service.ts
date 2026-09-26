import { chamarMultipart } from "../../../ts/api";
import type { EntradaBusca, RespostaBusca } from "../interfaces";

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
    for (const selfie of entrada.selfies) forma.append("selfies", selfie, selfie.name);

    return chamarMultipart<RespostaBusca>("participante", "busca", forma);
}
