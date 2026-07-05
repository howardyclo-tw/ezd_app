export function taipeiDateOf(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(d);
}
export function getTaipeiToday(): string { return taipeiDateOf(new Date()); }

export function formatTaipeiDateTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
