import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "./src/screens/HomeScreen";
import LoginScreen from "./src/screens/LoginScreen";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./src/firebaseConfig";

const Stack = createNativeStackNavigator();

// 👇 Altera essa flag pra true quando quiser ativar o login
const USE_AUTH = false;

export default function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!USE_AUTH) return; // se login desativado, não faz nada
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
    });
    return unsubscribe;
  }, []);

  const renderScreen = () => {
    if (!USE_AUTH) {
      // modo dev: ignora login e abre direto
      return <Stack.Screen name="Home" component={HomeScreen} />;
    }

    // modo normal: exige login
    return user ? (
      <Stack.Screen name="Home" component={HomeScreen} />
    ) : (
      <Stack.Screen name="Login" component={LoginScreen} />
    );
  };

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {renderScreen()}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
