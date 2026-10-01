import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  I18nManager,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Settings,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectionState } from '@/ConnectionState';
import { useMoneyData } from '@/MoneyData';
import { advisorBlocks, isHebrewText } from '@/advisor-content';
import { t, useLanguage } from '@/localization';
import { formatUnsignedMoney } from '@/money';
import {
  createAdvisorSession,
  getAdvisorSession,
  listAdvisorSessions,
  streamAdvisorReply,
  type AdvisorChart,
  type AdvisorMessage,
  type AdvisorSession,
} from '@/mobile-api';
import { useAppColors } from '@/theme';

const fixtureHebrewCategories: Record<string, string> = {
  Housing: 'דיור',
  Groceries: 'מזון',
  Dining: 'מסעדות',
  Transport: 'תחבורה',
  Shopping: 'קניות',
};

function rowDirection(rtl: boolean): 'row' | 'row-reverse' {
  return rtl === I18nManager.isRTL ? 'row' : 'row-reverse';
}

/** Text alignment follows the app's native direction; messages can use either language. */
function textAlignment(rtl: boolean): 'left' | 'right' {
  return rtl === I18nManager.isRTL ? 'left' : 'right';
}

function formattedReply(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return (
        <Text key={index} style={{ fontWeight: '700' }}>
          {part.slice(2, -2)}
        </Text>
      );
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <Text key={index} style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
          {part.slice(1, -1)}
        </Text>
      );
    return part;
  });
}

export default function AdvisorScreen() {
  const colors = useAppColors();
  const { language } = useLanguage();
  const appHebrew = language === 'he';
  const insets = useSafeAreaInsets();
  const { credential, home, source, status } = useMoneyData();
  const hebrewPreview =
    source === 'fixture' && (appHebrew || Settings.get('MM_ADVISOR_HEBREW_PREVIEW') === '1');
  const [sessions, setSessions] = useState<AdvisorSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AdvisorMessage[]>([]);
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const supportsGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable();
  const GlassSurface = supportsGlass ? GlassView : View;
  const messageScroll = useRef<ScrollView>(null);
  const selectionVersion = useRef(0);
  const lastUserText = messages.filter((message) => message.role === 'user').at(-1)?.content ?? '';
  const chatHebrew = input || lastUserText ? isHebrewText(input || lastUserText) : appHebrew;

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (source !== 'fixture' || !home) return;
    const points = home.categories
      .filter((item) => item.spent > 0)
      .slice(0, 5)
      .map((item) => ({
        label: hebrewPreview ? (fixtureHebrewCategories[item.name] ?? item.name) : item.name,
        value: item.spent,
      }));
    setMessages([
      {
        role: 'user',
        content: hebrewPreview
          ? `על מה הוצאתי הכי הרבה בחודש ${home.monthKey}?`
          : `Where did my money go in ${home.month}?`,
        timestamp: 'fixture-user',
      },
      {
        role: 'assistant',
        content: points.length
          ? `${hebrewPreview ? `ההוצאה הגבוהה ביותר הייתה על ${points[0].label}: ${formatUnsignedMoney(points[0].value, home.currencyCode)}. הקישו על עמודה כדי לראות את הסכום.` : `Your largest category was ${points[0].label} at ${formatUnsignedMoney(points[0].value, home.currencyCode)}. Tap a bar to explore the amounts.`}\n\n| ${hebrewPreview ? 'קטגוריה | הוצאה' : 'Category | Spent'} |\n| --- | ---: |\n${points.map((point) => `| ${point.label} | ${formatUnsignedMoney(point.value, home.currencyCode)} |`).join('\n')}`
          : hebrewPreview
            ? `אין הוצאות לפי קטגוריה בחודש ${home.monthKey}.`
            : `There is no category spending to chart for ${home.month}.`,
        timestamp: 'fixture-assistant',
        chart:
          points.length && home.currencyCode === 'ILS'
            ? {
                kind: 'bar',
                title: `${hebrewPreview ? 'הוצאות לפי קטגוריה' : 'Spending by category'} · ${home.monthKey}`,
                currencyCode: 'ILS',
                points,
              }
            : undefined,
      },
    ]);
  }, [hebrewPreview, home, source]);

  useEffect(() => {
    if (!credential || status !== 'ready') return;
    let live = true;
    const version = selectionVersion.current;
    setLoading(true);
    void listAdvisorSessions(credential)
      .then(async (items) => {
        if (!live) return;
        setSessions(items);
        if (items[0] && selectionVersion.current === version) {
          const session = await getAdvisorSession(credential, items[0].id);
          if (live && selectionVersion.current === version) {
            setActiveId(items[0].id);
            setMessages(session.messages);
          }
        }
      })
      .catch((caught) => {
        if (live) setError(caught instanceof Error ? caught.message : 'Chats could not load.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [credential, status]);

  if (status !== 'ready') return <ConnectionState />;

  async function openSession(id: string) {
    if (!credential || busy) return;
    const version = ++selectionVersion.current;
    setHistoryOpen(false);
    setError('');
    setLoading(true);
    try {
      const session = await getAdvisorSession(credential, id);
      if (selectionVersion.current !== version) return;
      setActiveId(id);
      setMessages(session.messages);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chat could not load.');
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !credential) return;
    ++selectionVersion.current;
    setBusy(true);
    setInput('');
    setError('');
    const replyInHebrew = isHebrewText(text);
    setStatusText(replyInHebrew ? 'חושב…' : 'Thinking…');
    let id = activeId;
    try {
      if (!id) {
        const session = await createAdvisorSession(credential);
        id = session.id;
        setActiveId(id);
        setSessions((current) => [session, ...current]);
      }
      setMessages((current) => [
        ...current,
        { role: 'user', content: text, timestamp: new Date().toISOString() },
      ]);
      let response = '';
      let chart: AdvisorChart | undefined;
      await streamAdvisorReply(credential, id, text, (event) => {
        if (event.type === 'status')
          setStatusText(replyInHebrew ? 'בודק נתונים…' : (event.text ?? 'Thinking…'));
        if (event.type === 'text_delta') response += event.text ?? '';
        if (event.type === 'result') response = event.text ?? response;
        if (event.type === 'chart') chart = event.chart;
        if (event.type === 'error') setError(event.text ?? 'The advisor could not reply.');
        if (event.type === 'text_delta' || event.type === 'result' || event.type === 'chart') {
          const content = response;
          const graph = chart;
          setMessages((current) => {
            const last = current.at(-1);
            const assistant = {
              role: 'assistant' as const,
              content,
              timestamp: new Date().toISOString(),
              chart: graph,
            };
            return last?.role === 'assistant' && last.timestamp === 'streaming'
              ? [...current.slice(0, -1), { ...assistant, timestamp: 'streaming' }]
              : [...current, { ...assistant, timestamp: 'streaming' }];
          });
        }
      });
      const saved = await getAdvisorSession(credential, id);
      setMessages(saved.messages);
      setSessions(await listAdvisorSessions(credential));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The advisor could not reply.');
    } finally {
      setBusy(false);
      setStatusText('');
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: colors.background }]}
      testID="advisor-screen"
    >
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top + 4,
          },
        ]}
      >
        <GlassSurface
          {...(supportsGlass ? { glassEffectStyle: 'regular' as const } : {})}
          style={[
            styles.actions,
            !supportsGlass && { backgroundColor: colors.surface, borderColor: colors.separator },
          ]}
        >
          <Pressable
            accessibilityLabel={t('advisorPastChats')}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => setHistoryOpen(true)}
            style={({ pressed }) => [
              styles.iconButton,
              { opacity: busy ? 0.4 : pressed ? 0.55 : 1 },
            ]}
            testID="advisor-history"
          >
            <SymbolView name="clock.arrow.circlepath" size={19} tintColor={colors.accent} />
          </Pressable>
          <Pressable
            accessibilityLabel={t('advisorNewChat')}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              ++selectionVersion.current;
              setActiveId(null);
              setMessages([]);
              setError('');
              setLoading(false);
            }}
            style={({ pressed }) => [
              styles.iconButton,
              { opacity: busy ? 0.4 : pressed ? 0.55 : 1 },
            ]}
            testID="advisor-new-chat"
          >
            <SymbolView name="square.and.pencil" size={19} tintColor={colors.accent} />
          </Pressable>
        </GlassSurface>
      </View>

      <ScrollView
        ref={messageScroll}
        style={{ flex: 1 }}
        contentContainerStyle={styles.messages}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => messageScroll.current?.scrollToEnd({ animated: true })}
        onLayout={() => messageScroll.current?.scrollToEnd({ animated: false })}
        testID="advisor-messages"
      >
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
        {!loading && !messages.length ? (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.accentSoft }]}>
              <SymbolView name="sparkles" size={30} tintColor={colors.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('advisorAskAboutFinances')}
            </Text>
            <Text style={[styles.emptyText, { color: colors.secondary }]}>
              {t('advisorEmptyDescription')}
            </Text>
          </View>
        ) : null}
        {messages.map((message, index) => {
          const blocks = message.role === 'assistant' ? advisorBlocks(message.content) : [];
          const rtl = isHebrewText(message.content);
          return (
            <View
              key={`${index}-${message.timestamp}`}
              style={[
                message.role === 'user' ? styles.userBubble : styles.assistantMessage,
                message.role === 'user'
                  ? {
                      backgroundColor: colors.accentSoft,
                      alignSelf: I18nManager.isRTL ? 'flex-start' : 'flex-end',
                    }
                  : null,
              ]}
            >
              {message.role === 'user' ? (
                <Text
                  selectable
                  style={[
                    styles.messageText,
                    {
                      color: colors.text,
                      textAlign: textAlignment(rtl),
                      writingDirection: 'auto',
                    },
                  ]}
                >
                  {message.content}
                </Text>
              ) : (
                <View style={styles.assistantContent}>
                  <View style={[styles.advisorIdentity, { flexDirection: rowDirection(rtl) }]}>
                    <View style={[styles.advisorMark, { backgroundColor: colors.accentSoft }]}>
                      <SymbolView name="sparkles" size={13} tintColor={colors.accent} />
                    </View>
                    <Text style={[styles.advisorName, { color: colors.secondary }]}>
                      {rtl ? 'יועץ' : 'Advisor'}
                    </Text>
                  </View>
                  <View style={styles.response}>
                    {blocks.map((block, blockIndex) =>
                      block.kind === 'table' ? (
                        <AdvisorTable key={blockIndex} headers={block.headers} rows={block.rows} />
                      ) : (
                        <Text
                          key={blockIndex}
                          selectable
                          style={[
                            styles.messageText,
                            {
                              color: colors.text,
                              textAlign: textAlignment(isHebrewText(block.text)),
                              writingDirection: 'auto',
                            },
                          ]}
                        >
                          {formattedReply(block.text)}
                          {busy &&
                          message.timestamp === 'streaming' &&
                          blockIndex === blocks.length - 1
                            ? ' ▍'
                            : ''}
                        </Text>
                      ),
                    )}
                  </View>
                </View>
              )}
              {message.chart ? <AdvisorChartView chart={message.chart} /> : null}
            </View>
          );
        })}
        {busy && statusText && messages.at(-1)?.timestamp !== 'streaming' ? (
          <View
            style={[
              styles.progress,
              { backgroundColor: colors.surface, borderColor: colors.separator },
            ]}
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={{ color: colors.secondary, fontSize: 13, writingDirection: 'auto' }}>
              {statusText}
            </Text>
          </View>
        ) : null}
        {error ? (
          <Text style={[styles.error, { color: colors.danger }]} testID="advisor-error">
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <GlassSurface
        {...(supportsGlass ? { glassEffectStyle: 'regular' as const } : {})}
        style={[
          styles.composer,
          {
            borderColor: colors.glassBorder,
            backgroundColor: supportsGlass ? undefined : colors.glass,
            shadowColor: colors.glassShadow,
            marginBottom: keyboardOpen ? 12 : insets.bottom + 28,
          },
        ]}
      >
        <TextInput
          accessibilityLabel={t('advisorMessage')}
          editable={!busy && (source === 'live' || hebrewPreview)}
          multiline
          onChangeText={setInput}
          placeholder={chatHebrew ? 'מה השתנה מהחודש שעבר?' : 'What changed since last month?'}
          placeholderTextColor={colors.secondary}
          selectionColor={colors.accent}
          style={[
            styles.input,
            {
              color: colors.text,
              textAlign: chatHebrew ? 'right' : 'left',
              writingDirection: 'auto',
            },
          ]}
          testID="advisor-input"
          value={input}
        />
        <Pressable
          accessibilityLabel={t('advisorSendMessage')}
          accessibilityRole="button"
          disabled={!input.trim() || busy || !credential}
          onPress={() => void send()}
          style={[
            styles.send,
            {
              backgroundColor:
                input.trim() && !busy && credential ? colors.accent : colors.surfaceSoft,
            },
          ]}
          testID="advisor-send"
        >
          <SymbolView
            name="arrow.up"
            size={18}
            tintColor={input.trim() && !busy && credential ? colors.background : colors.tertiary}
          />
        </Pressable>
      </GlassSurface>

      <Modal
        animationType="slide"
        onRequestClose={() => setHistoryOpen(false)}
        presentationStyle="pageSheet"
        visible={historyOpen}
      >
        <View style={[styles.history, { backgroundColor: colors.background }]}>
          <View style={styles.historyHeader}>
            <Text style={[styles.title, { color: colors.text }]}>{t('advisorPastChats')}</Text>
            <Pressable
              accessibilityLabel={t('advisorClosePastChats')}
              accessibilityRole="button"
              onPress={() => setHistoryOpen(false)}
            >
              <SymbolView name="xmark.circle.fill" size={26} tintColor={colors.secondary} />
            </Pressable>
          </View>
          <ScrollView>
            {sessions.map((session) => (
              <Pressable
                accessibilityRole="button"
                key={session.id}
                onPress={() => void openSession(session.id)}
                style={[styles.historyRow, { borderBottomColor: colors.separator }]}
                testID={`advisor-session-${session.id}`}
              >
                <Text
                  numberOfLines={2}
                  style={{
                    color: colors.text,
                    fontSize: 16,
                    textAlign: textAlignment(isHebrewText(session.title)),
                    writingDirection: 'auto',
                  }}
                >
                  {session.title}
                </Text>
                <Text style={{ color: colors.secondary, fontSize: 12 }}>
                  {new Date(session.updatedAt).toLocaleDateString(appHebrew ? 'he-IL' : 'en-US')}
                </Text>
              </Pressable>
            ))}
            {!sessions.length ? (
              <Text style={{ color: colors.secondary }}>{t('advisorNoPastChats')}</Text>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function AdvisorTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const colors = useAppColors();
  const rtl = isHebrewText(headers[0] ?? '');
  const { width } = useWindowDimensions();
  const viewport = Math.min(width - 40, 500);
  const firstWidth = headers.length === 2 ? viewport * 0.55 : 148;
  const otherWidth = Math.max(112, (viewport - firstWidth) / (headers.length - 1));
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[
        styles.table,
        { borderColor: colors.separator, backgroundColor: colors.surface, width: viewport },
      ]}
      testID="advisor-table"
    >
      <View>
        <View
          style={[
            styles.tableRow,
            { backgroundColor: colors.surfaceSoft, flexDirection: rowDirection(rtl) },
          ]}
        >
          {headers.map((header, index) => (
            <Text
              key={index}
              style={[
                styles.tableCell,
                styles.tableHead,
                {
                  color: colors.secondary,
                  width: index ? otherWidth : firstWidth,
                  textAlign: textAlignment(index ? !rtl : rtl),
                  writingDirection: 'auto',
                },
              ]}
            >
              {header}
            </Text>
          ))}
        </View>
        {rows.map((row, rowIndex) => (
          <View
            key={rowIndex}
            style={[
              styles.tableRow,
              {
                borderTopColor: colors.separator,
                borderTopWidth: StyleSheet.hairlineWidth,
                flexDirection: rowDirection(rtl),
              },
            ]}
          >
            {row.map((cell, index) => (
              <Text
                key={index}
                selectable
                style={[
                  styles.tableCell,
                  {
                    width: index ? otherWidth : firstWidth,
                    color: cell === '✓' ? colors.positive : index ? colors.text : colors.secondary,
                    textAlign: textAlignment(index ? !rtl : rtl),
                    writingDirection: /^[₪$€£\d]/.test(cell) ? 'ltr' : 'auto',
                  },
                ]}
              >
                {cell}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function AdvisorChartView({ chart }: { chart: AdvisorChart }) {
  const colors = useAppColors();
  const rtl = isHebrewText(chart.title);
  const [selected, setSelected] = useState(chart.kind === 'line' ? chart.points.length - 1 : 0);
  const [width, setWidth] = useState(260);
  const point = chart.points[selected] ?? chart.points[0];
  const max = Math.max(1, ...chart.points.map((item) => item.value));
  const line = Skia.Path.Make();
  if (chart.kind === 'line')
    chart.points.forEach((item, index) => {
      const x =
        chart.points.length === 1
          ? width / 2
          : 8 + (index * (width - 16)) / (chart.points.length - 1);
      const y = 112 - (item.value / max) * 100;
      if (index === 0) line.moveTo(rtl ? width - x : x, y);
      else line.lineTo(rtl ? width - x : x, y);
    });
  return (
    <View
      style={[styles.chart, { backgroundColor: colors.surface, borderColor: colors.separator }]}
      testID="advisor-chart"
    >
      <Text
        style={[
          styles.chartTitle,
          { color: colors.secondary, textAlign: textAlignment(rtl), writingDirection: 'auto' },
        ]}
      >
        {chart.title}
      </Text>
      <Text
        style={[
          styles.chartValue,
          { color: colors.text, textAlign: textAlignment(rtl), writingDirection: 'auto' },
        ]}
      >
        {point.label} · {formatUnsignedMoney(point.value, chart.currencyCode)}
      </Text>
      {chart.kind === 'line' ? (
        <View
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={{ height: 120 }}
        >
          <Canvas style={{ width, height: 120 }}>
            <Path
              path={line}
              color={colors.accent}
              style="stroke"
              strokeWidth={3}
              strokeCap="round"
              strokeJoin="round"
            />
          </Canvas>
          <View style={[StyleSheet.absoluteFill, { flexDirection: rowDirection(rtl) }]}>
            {chart.points.map((item, index) => (
              <Pressable
                accessibilityLabel={`${item.label}, ${formatUnsignedMoney(item.value, chart.currencyCode)}`}
                accessibilityRole="button"
                accessibilityState={{ selected: selected === index }}
                key={`${item.label}-${index}`}
                onPress={() => setSelected(index)}
                style={{ flex: 1 }}
              />
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.bars}>
          {chart.points.map((item, index) => (
            <Pressable
              accessibilityLabel={`${item.label}, ${formatUnsignedMoney(item.value, chart.currencyCode)}`}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === index }}
              key={`${item.label}-${index}`}
              onPress={() => setSelected(index)}
              style={[styles.barRow, { flexDirection: rowDirection(rtl) }]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.barLabel,
                  {
                    color: selected === index ? colors.text : colors.secondary,
                    textAlign: textAlignment(rtl),
                    writingDirection: 'auto',
                  },
                ]}
              >
                {item.label}
              </Text>
              <View
                style={[
                  styles.barTrack,
                  { backgroundColor: colors.surfaceSoft, flexDirection: rowDirection(rtl) },
                ]}
              >
                <View
                  style={{
                    width: `${(item.value / max) * 100}%`,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: colors.accent,
                    opacity: selected === index ? 1 : 0.55,
                  }}
                />
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  title: { fontSize: 27, fontWeight: '700' },
  actions: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messages: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24, flexGrow: 1, gap: 24 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  userBubble: {
    maxWidth: '86%',
    alignSelf: 'flex-end',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  assistantMessage: { width: '100%', alignSelf: 'flex-start' },
  assistantContent: { paddingVertical: 4 },
  advisorIdentity: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  advisorMark: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  advisorName: { fontSize: 13, fontWeight: '600' },
  response: { gap: 16 },
  messageText: { fontSize: 16, lineHeight: 25 },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 9,
    minHeight: 36,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  error: { fontSize: 13, marginLeft: 8 },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    maxWidth: 500,
    flexGrow: 0,
    alignSelf: 'flex-start',
  },
  tableRow: { flexDirection: 'row', alignItems: 'center' },
  tableCell: {
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontVariant: ['tabular-nums'],
  },
  tableHead: { fontWeight: '700' },
  composer: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 30,
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 3,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
    lineHeight: 22,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  history: { flex: 1, padding: 22 },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  historyRow: { paddingVertical: 16, borderBottomWidth: 1, gap: 5 },
  chart: {
    marginTop: 20,
    padding: 18,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 260,
  },
  chartTitle: { fontSize: 13, fontWeight: '500' },
  chartValue: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 16,
    fontVariant: ['tabular-nums'],
  },
  bars: { gap: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 },
  barLabel: { width: 85, fontSize: 12 },
  barTrack: { flex: 1, borderRadius: 6, overflow: 'hidden', height: 12 },
});
