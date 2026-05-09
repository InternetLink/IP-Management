// ============================================================================
// ISO 3166 Country & Region Data for Geofeed
// ============================================================================

export type Country = {
  code: string;
  name: string;
  flag: string;
};

export type Region = {
  code: string;
  name: string;
};

export const COUNTRIES: readonly Country[] = [
  { code: "TW", name: "Taiwan", flag: "🇹🇼" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "HK", name: "Hong Kong", flag: "🇭🇰" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "CN", name: "China", flag: "🇨🇳" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "TH", name: "Thailand", flag: "🇹🇭" },
  { code: "VN", name: "Vietnam", flag: "🇻🇳" },
  { code: "PH", name: "Philippines", flag: "🇵🇭" },
  { code: "MY", name: "Malaysia", flag: "🇲🇾" },
] as const;

export const REGIONS: Record<string, readonly Region[]> = {
  TW: [
    { code: "TW-TPE", name: "Taipei City" },
    { code: "TW-NWT", name: "New Taipei City" },
    { code: "TW-TXG", name: "Taichung City" },
    { code: "TW-KHH", name: "Kaohsiung City" },
    { code: "TW-TNN", name: "Tainan City" },
    { code: "TW-TAO", name: "Taoyuan City" },
    { code: "TW-HSZ", name: "Hsinchu City" },
    { code: "TW-CYI", name: "Chiayi City" },
  ],
  JP: [
    { code: "JP-13", name: "Tokyo" },
    { code: "JP-27", name: "Osaka" },
    { code: "JP-14", name: "Kanagawa" },
    { code: "JP-23", name: "Aichi" },
    { code: "JP-40", name: "Fukuoka" },
    { code: "JP-01", name: "Hokkaido" },
  ],
  US: [
    { code: "US-CA", name: "California" },
    { code: "US-TX", name: "Texas" },
    { code: "US-NY", name: "New York" },
    { code: "US-VA", name: "Virginia" },
    { code: "US-WA", name: "Washington" },
    { code: "US-IL", name: "Illinois" },
    { code: "US-OR", name: "Oregon" },
    { code: "US-NJ", name: "New Jersey" },
  ],
  SG: [{ code: "SG-01", name: "Central Singapore" }],
  HK: [
    { code: "HK-HCW", name: "Central and Western" },
    { code: "HK-KYT", name: "Kwun Tong" },
  ],
  KR: [
    { code: "KR-11", name: "Seoul" },
    { code: "KR-26", name: "Busan" },
  ],
  DE: [
    { code: "DE-HE", name: "Hessen" },
    { code: "DE-BY", name: "Bayern" },
    { code: "DE-NW", name: "Nordrhein-Westfalen" },
  ],
  NL: [
    { code: "NL-NH", name: "Noord-Holland" },
    { code: "NL-ZH", name: "Zuid-Holland" },
  ],
};

export function getCountryByCode(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

export function getRegionsByCountry(countryCode: string): readonly Region[] {
  return REGIONS[countryCode] ?? [];
}

export function getRegionName(countryCode: string, regionCode: string): string {
  const regions = getRegionsByCountry(countryCode);
  return regions.find((r) => r.code === regionCode)?.name ?? regionCode;
}

export function getCountryDisplay(code: string): string {
  const country = getCountryByCode(code);
  return country ? `${country.flag} ${country.code}` : code;
}
