import { login, signup } from "./actions";

const ERROS: Record<string, string> = {
  dados: "Confira o e-mail e use uma senha com pelo menos 8 caracteres.",
  credenciais: "E-mail ou senha incorretos.",
  cadastro: "Não foi possível criar a conta. A JUDITE funciona só por convite: confira se este e-mail foi convidado.",
  "nao-confirmado": "Confirme seu e-mail antes de entrar: abra o link que enviamos (veja também o spam).",
  aguarde: "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.",
  confirmacao: "O link de confirmação é inválido ou expirou.",
};

const AVISOS: Record<string, string> = {
  "confirme-email": "Conta criada. Abra o link que enviamos para o seu e-mail para ativá-la.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;
  const erro = typeof params.erro === "string" ? ERROS[params.erro] : undefined;
  const aviso = typeof params.aviso === "string" ? AVISOS[params.aviso] : undefined;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold">Entrar na JUDITE</h1>

        {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
        {aviso && <p role="status" className="text-sm text-green-700">{aviso}</p>}

        <label className="block space-y-1">
          <span className="text-sm">E-mail</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Senha</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <div className="flex gap-3">
          <button
            formAction={login}
            className="flex-1 rounded-md bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Entrar
          </button>
          <button
            formAction={signup}
            className="flex-1 rounded-md border border-zinc-300 px-4 py-2 dark:border-zinc-700"
          >
            Criar conta
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Recebeu um convite? Use o e-mail convidado, escolha uma senha e clique em Criar conta.
        </p>
      </form>
    </main>
  );
}
