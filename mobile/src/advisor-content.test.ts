import assert from 'node:assert/strict';
import test from 'node:test';
import { advisorBlocks, isHebrewText } from './advisor-content.ts';

test('preserves prose around multiple data and comparison tables', () => {
  assert.deepEqual(
    advisorBlocks(
      'Summary\n\n| Category | Spent |\n| --- | ---: |\n| Food | ₪420 |\n\n| Feature | A | B |\n| --- | :---: | ---: |\n| Included | ✓ | — |\n\nDone.',
    ),
    [
      { kind: 'text', text: 'Summary' },
      { kind: 'table', headers: ['Category', 'Spent'], rows: [['Food', '₪420']] },
      { kind: 'table', headers: ['Feature', 'A', 'B'], rows: [['Included', '✓', '—']] },
      { kind: 'text', text: 'Done.' },
    ],
  );
  assert.deepEqual(advisorBlocks('A | B\n| --- |'), [{ kind: 'text', text: 'A | B\n| --- |' }]);
  assert.deepEqual(advisorBlocks('| קטגוריה | הוצאה |\n| --- | ---: |\n| דיור | ₪7,200 |'), [
    { kind: 'table', headers: ['קטגוריה', 'הוצאה'], rows: [['דיור', '₪7,200']] },
  ]);
  assert.equal(isHebrewText('₪7,200 דיור'), true);
  assert.equal(isHebrewText('Spent at רמי לוי'), false);
});
