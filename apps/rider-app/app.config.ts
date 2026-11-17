import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = [...(config.plugins ?? [])];
  plugins.push([
    'expo-location',
    { locationWhenInUsePermission: 'Allow Boda-Tracker to show your location and plan a route during an active trip.' },
  ]);
  plugins.push('@maplibre/maplibre-react-native');

  return {
    ...config,
    name: config.name ?? 'Boda-Tracker Rider',
    slug: config.slug ?? 'boda-tracker-rider',
    plugins,
  };
};
