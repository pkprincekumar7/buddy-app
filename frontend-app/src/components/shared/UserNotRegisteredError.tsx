import { View, Text, TouchableOpacity } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { useTheme } from '@/lib/ThemeContext';

interface Props {
  onLogout: () => void;
}

const SUGGESTIONS = [
  'Verify you are logged in with the correct account',
  'Contact the app administrator for access',
  'Try logging out and back in again',
];

export default function UserNotRegisteredError({ onLogout }: Props) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 32,
          width: '100%',
          maxWidth: 400,
          alignItems: 'center',
        }}
      >
        <View
          style={{
            backgroundColor: colors.warning + '1A',
            borderRadius: 48,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <AlertTriangle size={32} color={colors.warning} />
        </View>

        <Text
          style={{
            color: colors.text,
            fontSize: 22,
            fontWeight: '700',
            marginBottom: 12,
            textAlign: 'center',
          }}
        >
          Access Restricted
        </Text>

        <Text
          style={{
            color: colors.textMuted,
            textAlign: 'center',
            marginBottom: 24,
            lineHeight: 22,
          }}
        >
          You are not registered to use this application. Please contact the app
          administrator to request access.
        </Text>

        <View
          style={{
            backgroundColor: colors.background,
            borderRadius: 8,
            padding: 16,
            width: '100%',
            marginBottom: 24,
          }}
        >
          <Text
            style={{ color: colors.textMuted, fontSize: 13, marginBottom: 8 }}
          >
            If you believe this is an error, you can:
          </Text>
          {SUGGESTIONS.map(item => (
            <Text
              key={item}
              style={{
                color: colors.textMuted,
                fontSize: 13,
                marginTop: 4,
                lineHeight: 20,
              }}
            >
              {'• '}
              {item}
            </Text>
          ))}
        </View>

        <TouchableOpacity
          style={{
            backgroundColor: colors.primary,
            paddingHorizontal: 32,
            paddingVertical: 12,
            borderRadius: 12,
          }}
          onPress={onLogout}
        >
          <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>
            Log Out
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
