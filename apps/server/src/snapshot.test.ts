import { describe, expect, it } from 'vitest';
import { withAuthorNames, type SnapshotPost } from './snapshot.ts';

const post = (id: number, participantId: number | null, authorName: string | null = null): SnapshotPost => ({
  id,
  participantId,
  authorName,
  text: `Karte ${id}`,
  column: null,
  status: 'visible',
  votes: 0,
  createdAt: id,
});

describe('Namen an Beiträgen', () => {
  it('hängt den Namen an, wenn die Person einen angegeben hat', () => {
    const names = new Map([[1, 'Ada']]);
    const result = withAuthorNames([post(1, 1), post(2, 2), post(3, null), post(4, 1, 'Q&A-Name')], names);
    expect(result.map((p) => p.authorName)).toEqual(['Ada', null, null, 'Q&A-Name']);
  });
});
