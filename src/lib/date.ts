export function taipeiDateOf(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(d);
}
export function getTaipeiToday(): string { return taipeiDateOf(new Date()); }
