"use client";

import { LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";

export function LogoutButton() {
  return (
    <button type="button" onClick={() => logout()} className="outline-button full-button">
      <LogOut aria-hidden="true" size={18} />
      Logout
    </button>
  );
}
