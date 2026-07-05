import type { ReactNode } from 'react';
import { RequireAdmin } from '@/components/Guards';
import { MemberNav } from '@/components/MemberNav';
import { AdminNav } from '@/components/AdminNav';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAdmin>
      <MemberNav />
      <div className="admin-shell">
        <AdminNav />
        <div className="admin-content">{children}</div>
      </div>
    </RequireAdmin>
  );
}
