import ForgotPasswordForm from './ForgotPasswordForm'

export const metadata = { title: 'Reset password' }

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your email and we&apos;ll send a reset link.
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="text-center text-sm text-muted-foreground">
          <a href="/login" className="font-medium text-foreground underline underline-offset-4">
            Back to sign in
          </a>
        </p>
      </div>
    </main>
  )
}
