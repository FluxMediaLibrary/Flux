import { Suspense, type ReactNode } from 'react';
import { RequireAdmin } from '@/components/Guards';
import { Navbar } from '@/components/Navbar';
import { AdminNav } from '@/components/AdminNav';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAdmin>
      <Suspense fallback={null}>
        <Navbar />
      </Suspense>
      <div className="admin-shell">
        <AdminNav />
        <div className="admin-content">{children}</div>
      </div>
    </RequireAdmin>
  );
}
