/** Every IANA time zone this server knows, for pickers; Europe/London first. */
export function timeZoneOptions(): { value: string; label: string }[] {
  const zones = Intl.supportedValuesOf('timeZone');
  const all = zones.includes('Europe/London') ? zones : ['Europe/London', ...zones];
  return [
    { value: 'Europe/London', label: 'Europe/London (UK)' },
    ...all
      .filter((z) => z !== 'Europe/London')
      .map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') })),
  ];
}
