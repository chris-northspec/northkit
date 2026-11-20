import { LoadingState } from '@/components/states';

// Loading state (standard 13): a skeleton shaped like a page of cards and rows.
export default function Loading() {
  return <LoadingState label="Loading…" tiles={3} rows={6} />;
}
