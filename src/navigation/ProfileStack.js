import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ProfileScreen from "../screens/profile/ProfileScreen";
import ProfileManagement from "../screens/ProfileScreen";
import RunDetailScreen from "../screens/Runs/RunDetailScreen";
import { WayperTheme } from "../theme/wayperTheme";

const Stack = createNativeStackNavigator();

export default function ProfileStack({ route }) {
  // Key only the displayed identity; Ranking remains mounted in its parent stack.
  const userId = route.params?.userId ?? route.params?.playerId ?? route.params?.friendId;
  return <Stack.Navigator key={userId || "self"} screenOptions={{
    headerStyle: { backgroundColor: WayperTheme.colors.background }, headerTintColor: WayperTheme.colors.text,
  }}>
    <Stack.Screen name="ProfileHome" component={ProfileScreen} initialParams={{ ...route.params, profileEntry: route.name }} options={{ headerShown: false }} />
    <Stack.Screen name="ProfileManagement" component={ProfileManagement} options={{ headerShown: false }} />
    <Stack.Screen name="ActivityDetail" component={RunDetailScreen} options={{ title: "Detalhes da atividade" }} />
  </Stack.Navigator>;
}
