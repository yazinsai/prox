import type { DashboardBreakdown } from '@/services/api/dashboard';

export function rankRequestBreakdown(
  rows: readonly DashboardBreakdown[],
  limit = 5
): DashboardBreakdown[] {
  return [...rows].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id)).slice(0, limit);
}
