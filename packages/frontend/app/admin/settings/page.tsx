import { Suspense } from 'react';
import { LoadingState } from '@/components/admin/AdminUI';
import { SettingsWorkspace } from '@/components/settings/SettingsWorkspace';

export default function AdminSettingsPage() {
  return (
    <Suspense fallback={<div className="control-page"><LoadingState cards={4} /></div>}>
      <SettingsWorkspace />
    </Suspense>
  );
}
