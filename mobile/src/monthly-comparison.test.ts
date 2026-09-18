import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as money from './money.ts';

type Element = { type: string; props: Record<string, any> };
const element = (type: string, props: Record<string, any>, ...children: any[]): Element => ({
  type,
  props: { ...props, children: children.flat(Infinity).filter(Boolean) },
});
const flatten = (node: Element): Element[] => [
  node,
  ...(node.props.children ?? []).filter((child: any) => typeof child === 'object').flatMap(flatten),
];
const style = (node: Element) => Object.assign({}, ...[node.props.style].flat());
const text = (node: Element) => node.props.children.join('');

// Replay the real screen with deterministic history, without a Mac connection or native runtime.
function render(
  range: string,
  categories: { name: string; spent: number; color: string }[],
  spending = 1_000,
) {
  const code = readFileSync(
    new URL('../app/(tabs)/explore/monthly-comparison.tsx', import.meta.url),
    'utf8',
  );
  const module = { exports: {} as { replay: (props: any) => Element } };
  let state = 0;
  const mocks: Record<string, any> = {
    'expo-router': {},
    'expo-symbols': { SymbolView: 'SymbolView' },
    react: { useState: (initial: unknown) => [state++ === 0 ? range : initial, () => {}] },
    'react-native': {
      View: 'View',
      Text: 'Text',
      Pressable: 'Pressable',
      StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
    },
    '@/ConnectionState': {},
    '@/GlassSegmentedControl': {},
    '@/MoneyData': {},
    '@/money': money,
    '@/theme': { useAppColors: () => ({ separator: '#separator' }) },
  };
  runInNewContext(
    ts.transpileModule(code + '\nexport const replay = MonthlyComparison;', {
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
      React: { createElement: element },
    },
  );
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: `2026-${String(index + 1).padStart(2, '0')}`,
    label: index === 11 ? 'Sep' : 'Nov',
    spending,
    currencyCode: 'ILS',
    categories,
  }));
  return flatten(module.exports.replay({ months }));
}

test('all ranges plot every spending category in its own color, not a gray remainder', () => {
  const categories = Array.from({ length: 20 }, (_, index) => ({
    name: `Category ${index}`,
    spent: index === 0 ? 800 : 1,
    color: `color-${index}`,
  }));
  categories.push({ name: 'Other', spent: -250, color: '#gray' });
  for (const range of ['3', '6', '12']) {
    const nodes = render(range, categories);
    const month = nodes.find((node) => node.props.testID === 'monthly-bar-2026-12')!;
    const bar = flatten(month).find((node) =>
      node.props.children.some(
        (child: Element) => child?.props?.style?.backgroundColor === 'color-0',
      ),
    )!;
    assert.equal(bar.props.children.length, 20);
    const segments = bar.props.children.map((node: Element) => style(node));
    assert.ok(
      Math.abs(
        segments.reduce((sum: number, segment: any) => sum + parseFloat(segment.height), 0) - 100,
      ) < 0.001,
    );
    assert.ok(!segments.some((segment: any) => segment.backgroundColor === '#gray'));
    assert.equal(style(bar).height, (819 / money.niceChartMaximum(819, 5)) * 168);
    for (const category of categories) {
      const row = nodes.find((node) => node.props.testID === `monthly-category-${category.name}`)!;
      assert.ok(row, `${category.name} has a matching legend/drill-down`);
      assert.equal(style(row.props.children[0]).backgroundColor, category.color);
    }
    const other = nodes.find((node) => node.props.testID === 'monthly-category-Other')!;
    assert.ok(flatten(other).some((node) => node.type === 'Text' && text(node) === '−₪250'));
    assert.ok(
      flatten(other).some((node) => node.type === 'Text' && text(node).includes('Net received')),
    );
  }
});

test('year labels are single-line and independent of the shared zero baseline', () => {
  const nodes = render('12', [{ name: 'Rent', spent: 500, color: '#orange' }]);
  const month = nodes.find((node) => node.props.testID === 'monthly-bar-2026-12')!;
  const label = flatten(month).find((node) => node.type === 'Text' && text(node) === 'Sep')!;
  assert.equal(label.props.numberOfLines, 1);
  assert.equal(style(label).position, 'absolute');
  assert.equal(style(label).top, 168);
  assert.equal(style(month).height, 168);
});

test('months with only credits do not invent spending bars', () => {
  const month = render('6', [{ name: 'Other', spent: -250, color: '#gray' }], 0).find(
    (node) => node.props.testID === 'monthly-bar-2026-12',
  )!;
  const bar = month.props.children[0];
  assert.equal(style(bar).height, 0);
});
