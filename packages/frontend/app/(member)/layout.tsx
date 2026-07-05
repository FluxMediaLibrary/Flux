import type { ReactNode } from 'react';
import { RequireProfile } from '@/components/Guards';
import { MemberNav } from '@/components/MemberNav';

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <RequireProfile>
      <MemberNav />
      <main className="page">{children}</main>
    </RequireProfile>
  );
}
