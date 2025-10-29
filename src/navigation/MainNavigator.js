import React from "react";
import { createDrawerNavigator } from "@react-navigation/drawer";
import HomeScreen from "../screens/HomeScreen";
import RankingScreen from "../screens/RankingScreen";
import FriendsScreen from "../screens/FriendsScreen";
import ClubScreen from "../screens/ClubScreen";

const Drawer = createDrawerNavigator();

export default function MainNavigator() {
  return (
    <Drawer.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: true,
        drawerType: "slide",
      }}
    >
      <Drawer.Screen name="🏠 Início" component={HomeScreen} />
      <Drawer.Screen name="🏆 Ranking" component={RankingScreen} />
      <Drawer.Screen name="👥 Amigos" component={FriendsScreen} />
      <Drawer.Screen name="🏛 Clubes" component={ClubScreen} />
    </Drawer.Navigator>
  );
}
