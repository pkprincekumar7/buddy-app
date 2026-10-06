import React from 'react';
import { Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { color } from '@/theme';

/**
 * The web Layout's "Back" row (`px-4 pt-4`, ghost sm button) that sits in the
 * page flow directly under the header and scrolls away with the content.
 * Every Layout page renders it as the first child of its scroll content —
 * <PageScroll> does this for you.
 */
export default function PageBackRow({ className }: { className?: string }) {
  return (
    <View className={cn('flex-row px-4 pt-4', className)}>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => navigate(-1)}
        accessibilityLabel="Back"
      >
        <ArrowLeft size={16} color={color['muted-foreground']} />
        <Text className="text-xs font-medium text-muted-foreground">Back</Text>
      </Button>
    </View>
  );
}
