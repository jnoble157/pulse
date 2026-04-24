export function sanitizeNextPath(next: string): string {
  const trimmed = next.trim();
  if (!trimmed.startsWith('/')) return '/';
  if (trimmed.startsWith('//')) return '/';
  if (trimmed.includes('\\')) return '/';
  return trimmed;
}
