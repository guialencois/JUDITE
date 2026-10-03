import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-4xl font-semibold">JUDITE</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Inteligência de vendas e tráfego que testa, aprende e otimiza campanhas.
      </p>
      <Link
        href="/login"
        className="rounded-md bg-zinc-900 px-5 py-2.5 text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Entrar
      </Link>
    </main>
  );
}
