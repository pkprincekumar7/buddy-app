import { View, Text, TouchableOpacity } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';

interface Props {
  onLogout: () => void;
}

const SUGGESTIONS = [
  'Verify you are logged in with the correct account',
  'Contact the app administrator for access',
  'Try logging out and back in again',
];

export default function UserNotRegisteredError({ onLogout }: Props) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#0a0a0a',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <View
        style={{
          backgroundColor: '#111827',
          borderRadius: 16,
          borderWidth: 1,
          borderColor: '#1f2937',
          padding: 32,
          width: '100%',
          maxWidth: 400,
          alignItems: 'center',
        }}
      >
        <View
          style={{
            backgroundColor: 'rgba(249,115,22,0.1)',
            borderRadius: 48,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <AlertTriangle size={32} color="#fb923c" />
        </View>

        <Text
          style={{
            color: '#ffffff',
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
            color: '#94a3b8',
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
            backgroundColor: '#0f172a',
            borderRadius: 8,
            padding: 16,
            width: '100%',
            marginBottom: 24,
          }}
        >
          <Text style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
            If you believe this is an error, you can:
          </Text>
          {SUGGESTIONS.map(item => (
            <Text
              key={item}
              style={{
                color: '#94a3b8',
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
            backgroundColor: '#0d9488',
            paddingHorizontal: 32,
            paddingVertical: 12,
            borderRadius: 12,
          }}
          onPress={onLogout}
        >
          <Text style={{ color: '#ffffff', fontWeight: '600' }}>Log Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
