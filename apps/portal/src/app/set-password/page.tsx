import { Suspense } from 'react';
import { PasswordTokenForm } from '@/components/auth/password-token-form';

export default function SetPasswordPage() {
  return (
    <Suspense>
      <PasswordTokenForm mode="set" />
    </Suspense>
  );
}
