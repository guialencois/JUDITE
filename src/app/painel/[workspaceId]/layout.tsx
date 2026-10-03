import Link from "next/link";
import { carregarWorkspace } from "./carregar";

export default async function WorkspaceLayout(props: LayoutProps<"/painel/[workspaceId]">) {
  const { workspaceId } = await props.params;
  const { workspace } = await carregarWorkspace(workspaceId);
  const base = `/painel/${workspace.id}`;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-950 text-zinc-100">
      <nav className="border-b border-zinc-800">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
          <Link href="/painel" className="text-zinc-500 hover:text-zinc-300">JUDITE</Link>
          <span className="font-medium text-zinc-100">{workspace.name}</span>
          <Link href={base} className="text-zinc-400 hover:text-amber-400">Visão geral</Link>
          <Link href={`${base}/trafego`} className="text-zinc-400 hover:text-amber-400">Tráfego</Link>
          <Link href={`${base}/trafego/gerenciador`} className="text-zinc-400 hover:text-amber-400">Gerenciador</Link>
        </div>
      </nav>
      {props.children}
    </div>
  );
}
