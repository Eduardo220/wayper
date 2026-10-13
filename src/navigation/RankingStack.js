import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import RankingScreen from "../screens/RankingScreen";
import PlayerProfileScreen from "../screens/ranking/PlayerProfileScreen";

const Stack = createNativeStackNavigator();

export default function RankingStack() {
  return <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="RankingHome" component={RankingScreen} />
    <Stack.Screen name="PlayerProfile" component={PlayerProfileScreen} />
  </Stack.Navigator>;
}
