const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, min = 0, max = Number.POSITIVE_INFINITY) =>
  Math.max(min, Math.min(max, value));

export const TERRITORY_XP_CONFIG = {
  xpPerCapturedAreaM2: 1 / 15,
  xpPerStolenAreaM2: 1 / 10,
  leaderBonusXp: 120,
  conqueredBonusXp: 80,
  affectedUserBonusXp: 20,
  maxXp: 20000,
};

export function computeTerritoryXP(input = {}, config = TERRITORY_XP_CONFIG) {
  const capturedAreaM2 = Math.max(0, toNumber(input.capturedAreaM2));
  const newAreaM2 = Math.max(0, toNumber(input.newAreaM2));
  const stolenAreaM2 = Math.max(0, toNumber(input.stolenAreaM2));
  const becameLeaderCount = Math.max(0, Math.round(toNumber(input.becameLeaderCount)));
  const conqueredCount = Math.max(0, Math.round(toNumber(input.conqueredCount)));
  const affectedUsersCount = Math.max(0, Math.round(toNumber(input.affectedUsersCount)));

  const xpFromArea = Math.round(capturedAreaM2 * config.xpPerCapturedAreaM2);
  const xpFromNewArea = newAreaM2 > 0 ? Math.round(newAreaM2 / 30) : 0;
  const xpFromStolen = Math.round(stolenAreaM2 * config.xpPerStolenAreaM2);
  const leaderBonus = becameLeaderCount * config.leaderBonusXp;
  const conqueredBonus = conqueredCount * config.conqueredBonusXp;
  const affectedUsersBonus = affectedUsersCount * config.affectedUserBonusXp;
  const rawXp = xpFromArea + xpFromNewArea + xpFromStolen + leaderBonus + conqueredBonus + affectedUsersBonus;
  const xp = Math.round(clamp(rawXp, 0, config.maxXp));

  return {
    xp,
    rawXp,
    components: {
      xpFromArea,
      xpFromNewArea,
      xpFromStolen,
      leaderBonus,
      conqueredBonus,
      affectedUsersBonus,
    },
    input: {
      capturedAreaM2,
      newAreaM2,
      stolenAreaM2,
      becameLeaderCount,
      conqueredCount,
      affectedUsersCount,
    },
    maxXp: config.maxXp,
  };
}

export default {
  TERRITORY_XP_CONFIG,
  computeTerritoryXP,
};
