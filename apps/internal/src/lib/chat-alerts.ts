'use client';

/**
 * Chat alerts in the browser: the per-device sound / pop-up preferences, which
 * conversation is on screen right now (no alert for a message you are already
 * looking at), and the "ding" itself.
 *
 * Preferences live in this browser only — a convenience, like a remembered
 * filter — so every read is guarded and falls back to the defaults.
 */

const SOUND_KEY = 'rademics_chat_sound';
const POPUP_KEY = 'rademics_chat_popups';

function read(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function write(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private window / blocked storage: the choice lasts this visit only */
  }
}

/** Sound is on unless turned off. */
export const soundEnabled = (): boolean => read(SOUND_KEY, true);
export const setSoundEnabled = (on: boolean): void => write(SOUND_KEY, on);

/** Pop-ups need the browser's permission AND the person not having turned them off. */
export function popupsEnabled(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted' && read(POPUP_KEY, true);
}
export const setPopupsEnabled = (on: boolean): void => write(POPUP_KEY, on);

let openRoomId: string | null = null;
/** The chat page reports the conversation it is showing (null when it closes). */
export function setOpenRoom(id: string | null): void {
  openRoomId = id;
}
/** True when that conversation is on screen and the tab is the one being looked at. */
export function isViewing(roomId: string | undefined): boolean {
  return (
    Boolean(roomId) &&
    openRoomId === roomId &&
    document.visibilityState === 'visible' &&
    document.hasFocus()
  );
}

let audio: AudioContext | null = null;
/** A short, soft two-note chime — generated, so there is no sound file to load. */
export function playChime(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const now = audio.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(audio!.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch {
    /* no audio device, or the browser has not allowed sound on this page yet */
  }
}

/** Fired when a conversation is muted/unmuted, so the notifier re-reads the list. */
export const MUTE_EVENT = 'rademics:chat-muted';

/** A message as one plain line for previews: no **, _ or ` markers, list lines joined. */
export function plainText(body: string): string {
  return body
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1$2')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*\u2022]\s+/, '').trim())
    .filter(Boolean)
    .join(' · ');
}
