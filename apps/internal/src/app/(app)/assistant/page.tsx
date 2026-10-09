'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The AI Assistant is switched off for now (owner's call, 2026-10-09). The
 * screen itself is kept in components/assistant/assistant-screen.tsx — to bring
 * it back, render <AssistantScreen /> here and unhide it in lib/nav.ts.
 */
export default function AssistantPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);
  return null;
}
