import { useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { reportOperationalEvent } from './telemetry';
export function OperationalTelemetry() {
  const { user } = useAuth();
  useEffect(() => {
    const activity = () => {
      if (document.visibilityState === 'visible') void reportOperationalEvent('activity');
    };
    const error = () => {
      void reportOperationalEvent('uncaught_error');
    };
    const rejection = () => {
      void reportOperationalEvent('unhandled_rejection');
    };
    activity();
    const timer = setInterval(activity, 5 * 60000);
    document.addEventListener('visibilitychange', activity);
    window.addEventListener('online', activity);
    window.addEventListener('noted:telemetry-preference', activity);
    window.addEventListener('error', error);
    window.addEventListener('unhandledrejection', rejection);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', activity);
      window.removeEventListener('online', activity);
      window.removeEventListener('noted:telemetry-preference', activity);
      window.removeEventListener('error', error);
      window.removeEventListener('unhandledrejection', rejection);
    };
  }, [user?.id]);
  return null;
}
