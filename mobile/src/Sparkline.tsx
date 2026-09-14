import { Canvas, Path, Skia } from '@shopify/react-native-skia';

export function Sparkline({ color, values }: { color: string; values: number[] }) {
  const width = 62;
  const height = 28;
  const path = Skia.Path.Make();
  const min = Math.min(...values);
  const span = Math.max(1, Math.max(...values) - min);
  values.forEach((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - 3 - ((value - min) / span) * (height - 6);
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  return (
    <Canvas style={{ width, height }}>
      <Path
        path={path}
        color={color}
        style="stroke"
        strokeCap="round"
        strokeJoin="round"
        strokeWidth={2.2}
      />
    </Canvas>
  );
}
