import React from 'react';
import { View } from 'react-native';
import Spinner from './Spinner';

/** Full-screen centered spinner — the standard "page is loading" state. */
export default function PageLoader() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Spinner />
    </View>
  );
}
