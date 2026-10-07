const NOME_MAXIMO = 100;
const SENHA_MINIMA = 8;
// O scrypt roda sobre a senha inteira: sem teto, um texto enorme vira um jeito de travar a API.
const SENHA_MAXIMA = 200;
const LOGIN = /^[a-z0-9._-]{3,60}$/;

// O login vale como foi cadastrado, sem diferença de maiúsculas: quem digita "Francisco" entra.
export function normalizarLogin(login: string): string {
    return login.trim().toLowerCase();
}

export function validarLogin(login: unknown): string | null {
    if (typeof login !== "string" || !LOGIN.test(normalizarLogin(login)))
        return "O login deve ter de 3 a 60 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.";
    return null;
}

export function validarSenha(senha: unknown): string | null {
    if (typeof senha !== "string" || senha.length < SENHA_MINIMA) return "A senha deve ter pelo menos 8 caracteres.";
    return senha.length > SENHA_MAXIMA ? "A senha deve ter até 200 caracteres." : null;
}

export function validarNome(nome: unknown): string | null {
    if (typeof nome !== "string" || !nome.trim()) return "Informe o nome.";
    return nome.trim().length > NOME_MAXIMO ? "O nome deve ter até 100 caracteres." : null;
}
