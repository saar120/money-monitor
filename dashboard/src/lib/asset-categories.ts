export type AssetCategory = 'simple_value' | 'real_estate' | 'crypto' | 'brokerage';

const ASSET_CATEGORY_MAP: Record<string, AssetCategory> = {
  pension: 'simple_value',
  keren_hishtalmut: 'simple_value',
  fund: 'simple_value',
  real_estate: 'real_estate',
  crypto: 'crypto',
  brokerage: 'brokerage',
};

export function getAssetCategory(assetType: string): AssetCategory {
  return ASSET_CATEGORY_MAP[assetType] ?? 'simple_value';
}

export const CATEGORY_MOVEMENT_TYPES: Record<AssetCategory, string[]> = {
  simple_value: ['contribution'],
  real_estate: ['rent_income'],
  crypto: ['buy', 'sell'],
  brokerage: ['deposit', 'withdrawal', 'buy', 'sell', 'dividend'],
};
