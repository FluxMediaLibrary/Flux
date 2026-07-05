import type { ReactNode } from 'react';
import { RequireProfile } from '@/components/Guards';
import { MemberNav } from '@/components/MemberNav';
import { AmbientProvider } from '@/components/AmbientBackdrop';

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <RequireProfile>
      <AmbientProvider>
        <MemberNav />
        <main className="page">{children}</main>
      </AmbientProvider>
    </RequireProfile>
  );
}
