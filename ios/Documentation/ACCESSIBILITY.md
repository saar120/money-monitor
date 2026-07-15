# Accessibility acceptance plan

Accessibility is part of each feature's definition of done, not a release-end audit.

## Required support

- Dynamic Type through accessibility sizes.
- VoiceOver with logical reading and focus order.
- Bold Text and Button Shapes.
- Increased Contrast and Differentiate Without Color.
- Reduce Transparency and Reduce Motion.
- Switch Control and Voice Control for primary flows.
- System Light/Dark Mode.
- Mixed Hebrew/English merchant content and future RTL localization.

## Component rules

- Interactive targets are at least 44 by 44 points where practical.
- Amount labels announce currency, sign, and context—not a raw symbol sequence.
- Icon-only controls have concise accessibility labels and, where useful, hints.
- Combined transaction rows announce merchant, date/category, amount, and review state in a useful order.
- Status never relies only on green, red, or orange.
- Decorative images and symbols are hidden from the accessibility tree.
- Errors move focus or announce once without repeatedly interrupting the user.

## Charts

- Provide a concise text summary before or alongside the chart.
- Expose meaningful points, ranges, and selected values to VoiceOver.
- Use Audio Graph support where Swift Charts provides it.
- Do not rely on color alone to separate series; add labels, symbols, or line treatment.
- Handle zero points, one point, negative ranges, and mixed currencies without misleading axes.

## Liquid Glass

System components automatically respond to Reduce Transparency, Increased Contrast, and Reduce Motion. Custom translucent controls must read the corresponding environment values and provide an opaque, high-contrast fallback. Financial content is already opaque by design.

## Text and localization

- Use SwiftUI text styles instead of fixed sizes.
- Allow multiline labels and avoid fixed-height text containers.
- Format currency and dates with the user's locale while retaining the source currency.
- Test long Hebrew merchant names, Latin digits inside RTL text, and bidirectional punctuation.
- Do not truncate the only visible explanation of live versus cached data.

## Manual test matrix

For each phase, test at minimum:

| Dimension | Values |
| --- | --- |
| Appearance | Light, Dark, Increased Contrast |
| Text | Default, largest accessibility size, Bold Text |
| Motion/material | Default, Reduce Motion, Reduce Transparency |
| Input | Touch, VoiceOver, Switch Control for critical path |
| Device | Small iPhone, current Pro size, physical iPhone, iPad/landscape checkpoint |
| Language content | English UI with Hebrew merchant data; future full RTL locale |
| Connectivity | Live, slow, cached, Mac unavailable, token revoked |

## Feature acceptance questions

1. Can the task be completed without seeing color?
2. Does the reading order still make sense at maximum text size?
3. Is live versus saved data unmistakable when spoken?
4. Can a user recover from every error without a hidden gesture?
5. Does hidden/locked financial content stay hidden from snapshots and assistive output?

