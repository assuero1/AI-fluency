"use client";

import { LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => logout()}
      className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
    >
      <LogOut size={16} />
      Sair da conta
    </button>
  );
}
