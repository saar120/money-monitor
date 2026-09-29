import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as money from './money.ts';
import { categoryLabel, t } from './translations.ts';

type Element = {
  type: unknown;
  props: Record<string, unknown> & {
    children: Element[];
    style?: Record<string, unknown>;
    onSelect: (index: number) => void;
  };
};
const element = (type: unknown, props: Element['props'], ...children: Element[]): Element => ({
  type,
  props: { ...props, children: children.flat(Infinity).filter(Boolean) },
});
const flatten = (node: Element): Element[] => [
  node,
  ...(node.props.children ?? []).filter((child) => typeof child === 'object').flatMap(flatten),
];
const style = (node: Element) => Object.assign({}, ...[node.props.style].flat());

function render(file: string, component: string, value: number) {
  const module = { exports: {} as { replay: (props: Record<string, unknown>) => Element } };
  const mocks: Record<string, unknown> = {
    react: {
      useState: (value: unknown) => [value, () => {}],
      useMemo: (fn: () => unknown) => fn(),
    },
    'react-native-reanimated': {
      __esModule: true,
      default: { View: 'View' },
      useReducedMotion: () => false,
    },
    'react-native': {
      View: 'View',
      Pressable: 'Pressable',
      ScrollView: 'ScrollView',
      StyleSheet: { create: (value: unknown) => value, hairlineWidth: 0.5 },
    },
    'expo-router': {},
    '@/Motion': {
      ChartScrubber: 'Scrubber',
      MonthSwipe: 'View',
      MotionRow: 'View',
      RollingAmount: 'Text',
    },
    '@/LocalizedText': { Text: 'Text' },
    '@/localization': { t, useLanguage: () => ({ language: 'en' }) },
    '@/locale-state': { currentLocale: () => 'en-IL', formatMonthShort: () => 'Sep' },
    '@/translations': { categoryLabel },
    '@/money': money,
    '@/theme': { useAppColors: () => ({ accent: '#income', blueSoft: '#spending' }) },
    '@/MoneyData': { useActivityTransactions: () => ({ transactions: [] }) },
    '@/ConnectionState': {},
    '@/GlassSegmentedControl': {},
    '@/MonthPicker': {},
    '@/DirectionalChevron': {},
  };
  const code = readFileSync(new URL(`../app/(tabs)/explore/${file}.tsx`, import.meta.url), 'utf8');
  runInNewContext(
    ts.transpileModule(`${code}\nexport const replay = ${component};`, {
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
  const month = {
    month: '2026-09',
    income: value,
    spending: value,
    currencyCode: 'ILS',
    merchants: [],
    categories: [{ name: 'Dining', spent: value, previous: 0, color: '#category' }],
  };
  return flatten(module.exports.replay({ months: [month], name: 'Dining' }));
}

for (const [file, component, colors] of [
  ['cash-flow', 'CashFlowChart', ['#income', '#spending']],
  ['category/[name]', 'CategoryContent', ['#category']],
] as const) {
  test(`${file}: zero and credit values never become positive bars; selection keeps baseline`, () => {
    for (const value of [0, -100, 500]) {
      const nodes = render(file, component, value);
      const scrubber = nodes.find((node) => node.type === 'Scrubber')!;
      const bars = flatten(scrubber).filter(
        (node) =>
          colors.includes(style(node).backgroundColor as never) &&
          typeof style(node).height === 'number',
      );
      assert.equal(bars.length, colors.length);
      for (const bar of bars) {
        assert.equal(style(bar).transform, undefined);
        assert.equal(bar.props.layout, undefined);
        assert.equal(style(bar).height > 0, value > 0);
      }
      assert.doesNotThrow(
        () => scrubber.props.onSelect(99),
        'queued indexes from a larger range are ignored',
      );
    }
  });
}
