import { LoadingState } from '@/components/states';

// Loading state (studio standard 02): a skeleton shaped like a page of tiles and rows.
export default function Loading() {
  return <LoadingState label="Loading…" tiles={3} rows={6} />;
}
