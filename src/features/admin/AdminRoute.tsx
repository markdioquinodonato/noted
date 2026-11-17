import { useOutletContext } from 'react-router';
import { AdminLayout } from './AdminLayout';
import { SupabaseMonitoring } from './AdminInfrastructure';
import { TranscriptionAdmin } from '@/features/transcription/TranscriptionAdmin';

export function AdminRoute() {
  const { central } = useOutletContext<{ central: boolean }>();
  return <AdminLayout central={central} />;
}
export function StorageRoute() {
  return <SupabaseMonitoring storageOnly />;
}
export function CostsRoute() {
  return <TranscriptionAdmin costs />;
}
