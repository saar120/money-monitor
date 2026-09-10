import { Settings } from 'react-native';
import { fixtureScenarios, type FixtureScenario, type FixtureScenarioName } from './fixtures';

const launchScenario = Settings.get('MM_FIXTURE_SCENARIO') as string | undefined;
const launchRefreshDelay = Number(Settings.get('MM_FIXTURE_REFRESH_DELAY_MS')) || 0;
let fixtureMode = Boolean(launchScenario && launchScenario in fixtureScenarios);

let selectedScenario: FixtureScenarioName =
  launchScenario && launchScenario in fixtureScenarios
    ? (launchScenario as FixtureScenarioName)
    : 'normal';

export function selectFixtureScenario(value: string | string[] | undefined): void {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && candidate in fixtureScenarios) {
    selectedScenario = candidate as FixtureScenarioName;
    fixtureMode = true;
  }
}

export function isFixtureMode(): boolean {
  return fixtureMode;
}

export function getFixtureScenario(): FixtureScenario {
  return fixtureScenarios[selectedScenario];
}

export function getFixtureRefreshDelay(): number {
  return Math.max(0, launchRefreshDelay);
}
