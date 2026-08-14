import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="auth-screen">
      <div className="auth-inner">
        <LoginForm />
      </div>
    </main>
  );
}
