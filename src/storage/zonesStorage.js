import AsyncStorage from '@react-native-async-storage/async-storage';

const ZONES_KEY = '@wayper_zones';

// Salva todas as zonas
export const saveZones = async (zones) => {
  try {
    await AsyncStorage.setItem(ZONES_KEY, JSON.stringify(zones));
  } catch (e) {
    console.error('Erro ao salvar zonas:', e);
  }
};

// Carrega as zonas salvas
export const loadZones = async () => {
  try {
    const data = await AsyncStorage.getItem(ZONES_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Erro ao carregar zonas:', e);
    return [];
  }
};

// Apagar tudo (caso precise resetar)
export const clearZones = async () => {
  try {
    await AsyncStorage.removeItem(ZONES_KEY);
  } catch (e) {
    console.error('Erro ao limpar zonas:', e);
  }
};
