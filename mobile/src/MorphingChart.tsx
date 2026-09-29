import { memo, type ComponentProps } from 'react';
import { Area, Line } from 'victory-native';

// Keep geometry synchronous with axes and hit testing. Victory restarts interrupted
// morphs from the previous target, and can rebuild incompatible SVG paths every frame.
export const MorphingLine = memo(function ChartLine({
  points,
  ...props
}: ComponentProps<typeof Line>) {
  return <Line {...props} points={points} />;
});

export const MorphingArea = memo(function ChartArea({
  points,
  ...props
}: ComponentProps<typeof Area>) {
  return <Area {...props} points={points} />;
});
