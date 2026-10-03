import { papelNoWorkspace } from "@/lib/trafego/acesso";

/** Conexões guardam chaves que mexem em dinheiro: só o DONO do workspace pode criar, trocar ou remover. */
export async function exigirDono(workspaceId: string) {
  const acesso = await papelNoWorkspace(workspaceId);
  if (!acesso || acesso.papel !== "owner") return null;
  return acesso;
}
