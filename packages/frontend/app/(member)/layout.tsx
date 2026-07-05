import { Suspense, type ReactNode } from 'react';
import { RequireProfile } from '@/components/Guards';
import { Navbar } from '@/components/Navbar';
import { AmbientProvider } from '@/components/AmbientBackdrop';

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <RequireProfile>
      <AmbientProvider>
        <Suspense fallback={null}>
          <Navbar />
          <main>{children}</main>
        </Suspense>
      </AmbientProvider>
    </RequireProfile>
  );
}
