import { Suspense } from 'react';
import { PasswordTokenForm } from '@/components/auth/password-token-form';

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <PasswordTokenForm mode="reset" />
    </Suspense>
  );
}
