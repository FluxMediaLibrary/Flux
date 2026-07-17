import { type ReactNode } from 'react';
import { RequireAdmin } from '@/components/Guards';
import { AdminControlCenter } from '@/components/admin/AdminControlCenter';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAdmin>
      <AdminControlCenter>{children}</AdminControlCenter>
    </RequireAdmin>
  );
}
