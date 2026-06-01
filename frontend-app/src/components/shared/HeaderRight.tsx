/**
 * HeaderRight — TTS toggle + Profile avatar (mirrors web Layout.tsx right-side controls)
 *
 * Web order: [Volume2/VolumeX]  [Profile avatar]
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Volume2, VolumeX } from 'lucide-react-native';
import { api } from '@/api/client';
import ProfileHeaderButton from './ProfileHeaderButton';

export default function HeaderRight() {
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const ttsEnabledRef = useRef(true);

  // Load persisted preference on mount — same as web Layout.tsx
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prefs = (await api.preferences.get()) as {
          tts_enabled?: boolean;
        };
        if (!cancelled && typeof prefs?.tts_enabled === 'boolean') {
          ttsEnabledRef.current = prefs.tts_enabled;
          setTtsEnabled(prefs.tts_enabled);
        }
      } catch {
        // ignore — default stays true
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = () => {
    const next = !ttsEnabledRef.current;
    ttsEnabledRef.current = next;
    setTtsEnabled(next);
    void api.preferences.patch({ tts_enabled: next }).catch(() => undefined);
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginRight: 4,
      }}
    >
      {/* TTS toggle — mirrors web's Volume2/VolumeX button */}
      <Pressable
        onPress={handleToggle}
        accessibilityLabel={ttsEnabled ? 'Turn off voice' : 'Turn on voice'}
        accessibilityRole="button"
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? 'rgba(255,255,255,0.08)' : 'transparent',
        })}
      >
        {ttsEnabled ? (
          <Volume2 size={18} color="#64748b" />
        ) : (
          <VolumeX size={18} color="#64748b" />
        )}
      </Pressable>

      {/* Profile avatar — existing component */}
      <ProfileHeaderButton />
    </View>
  );
}
