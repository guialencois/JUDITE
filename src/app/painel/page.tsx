import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createWorkspace, signOut } from "./actions";

const ERROS: Record<string, string> = {
  nome: "O nome precisa ter entre 2 e 80 caracteres.",
  criar: "Não foi possível criar o workspace. Tente novamente.",
};

export default async function PainelPage(props: PageProps<"/painel">) {
  const supabase = await createClient();

  // Segunda checagem, além do proxy: só usuários logados chegam aqui.
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name, created_at")
    .order("created_at", { ascending: true });

  const params = await props.searchParams;
  const erro = typeof params.erro === "string" ? ERROS[params.erro] : undefined;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Painel da JUDITE</h1>
          <p className="text-sm text-zinc-500">{auth.user.email}</p>
        </div>
        <form action={signOut}>
          <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
            Sair
          </button>
        </form>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Seus workspaces</h2>
        {workspaces && workspaces.length > 0 ? (
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link href={`/painel/${w.id}`} className="block px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  {w.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">Você ainda não tem nenhum workspace.</p>
        )}
      </section>

      <form action={createWorkspace} className="space-y-2">
        <label className="block space-y-1">
          <span className="text-sm">Novo workspace</span>
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder="Ex.: Guia Lençóis"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
        <button className="rounded-md bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900">
          Criar workspace
        </button>
      </form>
    </main>
  );
}
