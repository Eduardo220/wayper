import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "../screens/HomeScreen";
import RunDetailScreen from "../screens/Runs/RunDetailScreen";
import { WayperTheme } from "../theme/wayperTheme";

const Stack = createNativeStackNavigator();

export default function HomeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: WayperTheme.colors.background },
        headerTintColor: WayperTheme.colors.text,
        headerTitleStyle: { fontWeight: "900", fontSize: 20 },
      }}
    >
      <Stack.Screen name="InicioHome" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="ActivityDetail"
        component={RunDetailScreen}
        options={{ title: "Detalhes da atividade" }}
      />
    </Stack.Navigator>
  );
}
