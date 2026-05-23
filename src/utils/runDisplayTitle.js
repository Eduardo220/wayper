export const getRunDisplayTitle = (run) => {
  return (
    run?.title ||
    run?.name ||
    run?.customName ||
    run?.runName ||
    run?.metadata?.title ||
    run?.metadata?.name ||
    run?.summary?.title ||
    run?.summary?.name ||
    "Corrida Wayper"
  );
};
