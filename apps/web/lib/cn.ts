import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Stable class combinator — clsx + twMerge so later tokens win deterministically. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
