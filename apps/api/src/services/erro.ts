export class ErroTratado extends Error {
    // `codigo` é para a tela reagir sem depender do texto, que pode ser reescrito.
    constructor(
        mensagem: string,
        public codigo?: string
    ) {
        super(mensagem);
        this.name = "ErroTratado";
    }
}
