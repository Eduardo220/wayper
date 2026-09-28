const { withGradleProperties } = require("@expo/config-plugins");

const PROPERTY_KEY = "AsyncStorage_db_size_in_MB";
const DEFAULT_SIZE_MB = 32;

module.exports = function withAsyncStorageDatabaseSize(config, options = {}) {
  const requestedSize = Number(options.sizeMB ?? DEFAULT_SIZE_MB);
  const sizeMB = Number.isFinite(requestedSize) && requestedSize > 0
    ? Math.round(requestedSize)
    : DEFAULT_SIZE_MB;

  return withGradleProperties(config, (gradleConfig) => {
    const properties = gradleConfig.modResults;
    const existing = properties.find(
      (item) => item.type === "property" && item.key === PROPERTY_KEY
    );

    if (existing) {
      existing.value = String(sizeMB);
    } else {
      properties.push({
        type: "property",
        key: PROPERTY_KEY,
        value: String(sizeMB),
      });
    }

    return gradleConfig;
  });
};
