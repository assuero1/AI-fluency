"use client";

import { logout } from "@/app/login/actions";
import { TalkitoIcon } from "./TalkitoIcon";

export function LogoutButton() {
  return (
    <button type="button" onClick={() => logout()} className="outline-button full-button">
      <TalkitoIcon name="log-out" size={18} />
      Logout
    </button>
  );
}
