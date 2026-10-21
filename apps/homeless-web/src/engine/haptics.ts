// Haptic drivers. Native APK: @capacitor/haptics (impact / vibrate). Browser:
// navigator.vibrate when present (requires user activation; unsupported on many
// devices, e.g. iOS Safari). Otherwise no driver: meaning is carried by visuals/audio.
// A successful call is recorded as "requested"; whether it was felt is measured only on a device.
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { HapticDriver } from '@dark/somatostratum';

export function pickHapticDriver(): HapticDriver | null {
  if (Capacitor.isNativePlatform()) {
    return {
      name: 'capacitor-haptics',
      fire: async (pattern, intensity) => {
        try {
          // first pulse as an impact (crisp), remaining pulses as timed vibrations
          await Haptics.impact({ style: intensity < 0.6 ? ImpactStyle.Light : pattern[0]! > 30 ? ImpactStyle.Heavy : ImpactStyle.Medium });
          let delay = 0;
          for (let i = 1; i < pattern.length; i += 2) {
            delay += pattern[i]! + (pattern[i - 1] ?? 0);
            const d = pattern[i + 1];
            if (d) setTimeout(() => void Haptics.vibrate({ duration: d }), delay);
          }
          return true;
        } catch { return false; }
      },
      cancel: () => {},
    };
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    return {
      name: 'navigator.vibrate',
      fire: (pattern) => { try { return navigator.vibrate(pattern); } catch { return false; } },
      cancel: () => { try { navigator.vibrate(0); } catch { /* ignore */ } },
    };
  }
  return null;
}
