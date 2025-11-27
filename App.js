import "react-native-reanimated";
import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./src/firebaseConfig";

import LoginScreen from "./src/screens/Auth/LoginScreen";
import RegisterScreen from "./src/screens/Auth/RegisterScreen";
import MainNavigator from "./src/navigation/MainNavigator";

const Stack = createNativeStackNavigator();

// alterna pra false quando quiser rodar sem login
const USE_AUTH = true;

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!USE_AUTH) {
      setAuthChecked(true);
      return;
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthChecked(true);
    });

    return unsub;
  }, []);

  if (!authChecked) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>

        {/* sem login obrigatório */}
        {!USE_AUTH && (
          <Stack.Screen name="Main" component={MainNavigator} />
        )}

        {/* login obrigatório + logado */}
        {USE_AUTH && user && (
          <Stack.Screen name="Main" component={MainNavigator} />
        )}

        {/* login obrigatório + deslogado */}
        {USE_AUTH && !user && (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}

      </Stack.Navigator>
    </NavigationContainer>
  );
}
