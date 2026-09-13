import process from 'node:process';

export default ({ config }) => {
  if (process.env.MM_DEMO_BUILD !== '1') return config;

  return {
    ...config,
    name: 'Money Monitor Demo',
    scheme: 'moneymonitordemo',
    icon: './assets/icon-demo.png',
    ios: {
      ...config.ios,
      icon: './assets/icon-demo.png',
      bundleIdentifier: 'com.saaramrani.moneymonitor.demo',
    },
    extra: { ...config.extra, fixtureScenario: 'normal' },
  };
};
