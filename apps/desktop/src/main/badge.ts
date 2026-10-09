import { nativeImage, type NativeImage } from 'electron';
import { BADGES, BADGE_SIZES } from './badge-images';

/**
 * The brand-navy unread-count circle Windows shows on the corner of a taskbar button
 * (like the badges WhatsApp and Teams use). 1–9 as a number, 10+ as "9+".
 *
 * Pre-rendered with a real bold font at every display-scaling size (see
 * badge-images.ts), so Windows picks an exact-size image instead of blowing a
 * small one up — which is what made the first version look blocky.
 */
export function unreadBadge(count: number): NativeImage {
  const set = BADGES[count > 9 ? '9+' : String(count)]!;
  const image = nativeImage.createEmpty();
  for (const size of BADGE_SIZES) {
    image.addRepresentation({ scaleFactor: size / 16, buffer: Buffer.from(set[size]!, 'base64') });
  }
  return image;
}
