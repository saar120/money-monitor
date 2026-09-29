import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

test('detail rows retain native press styles and navigate with their month parameters', () => {
  const pushes: unknown[] = [];
  type Style = (state: { pressed: boolean }) => Record<string, string | number>[];
  type Row = {
    type: string;
    props: { style: Style; onPress: (event: { defaultPrevented: boolean }) => void };
  };
  const module = { exports: {} as { DetailLink: (props: Record<string, unknown>) => Row } };
  runInNewContext(
    ts.transpileModule(readFileSync(new URL('./DetailLink.tsx', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id: string) =>
        id === 'expo-router'
          ? { router: { push: (href: unknown) => pushes.push(href) } }
          : { Pressable: 'Pressable' },
      React: { createElement: (type: unknown, props: unknown) => ({ type, props }) },
    },
  );
  const href = { pathname: '/category/[name]', params: { name: 'Dining', month: '2026-07' } };
  const style = ({ pressed }: { pressed: boolean }) => [
    { flexDirection: 'row', minHeight: 76 },
    { opacity: pressed ? 0.68 : 1 },
  ];
  const row = module.exports.DetailLink({ href, style, accessibilityLabel: 'Dining' });
  assert.equal(row.type, 'Pressable');
  assert.equal(row.props.style, style, 'no slot may turn the callback into an empty style object');
  assert.equal(Object.assign({}, ...row.props.style({ pressed: true })).flexDirection, 'row');
  row.props.onPress({ defaultPrevented: false });
  row.props.onPress({ defaultPrevented: true });
  assert.deepEqual(pushes, [href]);
});
