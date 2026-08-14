import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <main className="auth-screen">
      <div className="auth-inner">
        <ResetPasswordForm />
      </div>
    </main>
  );
}
