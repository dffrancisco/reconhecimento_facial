// Mesmo formato que a tela de entrada lê: /#/?t=<token_upload>.
export function linkDeUpload(endereco: string, token: string): string {
    return `${endereco}/#/?t=${token}`;
}

const SO_NESTE_COMPUTADOR = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

// O endereço da rede local vem da configuração da estação: aberto na própria máquina, o painel
// estaria em localhost, e um QR com "localhost" não abre nada no celular do fotógrafo.
export function enderecoDosLinks(enderecoLan: string | null, origemDoPainel: string): { endereco: string; soNesteComputador: boolean } {
    if (enderecoLan) return { endereco: enderecoLan, soNesteComputador: false };
    return { endereco: origemDoPainel, soNesteComputador: SO_NESTE_COMPUTADOR.test(origemDoPainel) };
}
