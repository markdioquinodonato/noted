import { expect, it } from 'vitest';
import { capacityState, type Threshold } from '@/features/admin/types';
const threshold: Threshold = {
  metric: 'supabase_mau',
  limit_value: 100,
  warning_percent: 80,
  updated_at: '',
};
it('keeps unknown/stale provider capacity unknown instead of healthy or zero', () => {
  expect(capacityState(null, threshold)).toBe('unknown');
  expect(capacityState(10, threshold, true)).toBe('unknown');
  expect(capacityState(79, threshold)).toBe('within limit');
  expect(capacityState(80, threshold)).toBe('warning');
  expect(capacityState(100, threshold)).toBe('critical');
});
