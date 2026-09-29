import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

test('native chart paths use exact source coordinates and never queue geometry behind the scrubber', () => {
  const module = {
    exports: {} as Record<
      string,
      (props: Record<string, unknown>) => { props: Record<string, unknown> }
    >,
  };
  const code = readFileSync(new URL('./MorphingChart.tsx', import.meta.url), 'utf8');
  const mocks: Record<string, unknown> = {
    react: {
      memo: (component: unknown) => component,
      useMemo: (compute: () => unknown) => compute(),
    },
    'victory-native': { Line: 'Line', Area: 'Area' },
    'react-native-reanimated': { useReducedMotion: () => false },
  };
  runInNewContext(
    ts.transpileModule(code, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id: string) => mocks[id],
      React: { createElement: (type: string, props: unknown) => ({ type, props }) },
    },
  );
  for (const name of ['MorphingLine', 'MorphingArea']) {
    for (const points of [
      [],
      [{ x: 0, y: 0 }],
      [
        { x: 0, y: 4 },
        { x: 1, y: null },
        { x: 2, y: 7 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 90 },
        { x: 2, y: 1 },
      ],
    ]) {
      const output = module.exports[name]!({ points, color: '#fff', y0: 100 });
      assert.equal(output.props.points, points, 'retain source vertices and missing-data gaps');
      assert.equal(
        output.props.animate,
        undefined,
        'geometry must not lag behind hit testing or labels',
      );
    }
  }
});
