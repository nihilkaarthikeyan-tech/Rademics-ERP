'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingState } from '@rademics/ui';
import { getToken } from '@/lib/session';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getToken() ? '/dashboard' : '/login');
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center">
      <LoadingState label="Loading portal…" />
    </div>
  );
}
