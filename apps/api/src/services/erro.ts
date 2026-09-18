export class ErroTratado extends Error {
    constructor(mensagem: string) {
        super(mensagem);
        this.name = "ErroTratado";
    }
}
