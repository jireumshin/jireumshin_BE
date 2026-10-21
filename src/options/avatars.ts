// 프로필 캐릭터 — 이미지는 스토리지 버킷 avatars/{key}.png
export const AVATARS = [
  { key: 'judge', label: '판사' },
  { key: 'fact-bot', label: '팩트봇' },
  { key: 'impulse-fairy', label: '지름요정' },
  { key: 'value-fairy', label: '가성비요정' },
  { key: 'wallet-guardian', label: '텅장지킴이' },
] as const;

export const AVATAR_KEYS = AVATARS.map((a) => a.key);
export const DEFAULT_AVATAR = 'judge';

export function avatarUrl(publicBase: string, key?: string | null): string {
  return `${publicBase}/avatars/${key || DEFAULT_AVATAR}.png`;
}
