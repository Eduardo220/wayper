import React, { forwardRef } from "react";

import RunShareCard from "./RunShareCard";

const RunShareImageTemplate = forwardRef(function RunShareImageTemplate(
  {
    path = [],
    segments = [],
    zoneCoords = [],
    isZone = false,
    title = "Corrida Wayper",
    subtitle = "Corrida",
    distance = "0.00 km",
    duration = "--:--",
    pace = "--:--/km",
    date = "",
    area = "0 m2",
    mapStyle,
    style,
  },
  ref
) {
  return (
    <RunShareCard
      ref={ref}
      mode="card"
      path={path}
      segments={segments}
      zoneCoords={zoneCoords}
      isZone={isZone}
      title={title}
      subtitle={subtitle}
      distance={distance}
      duration={duration}
      pace={pace}
      date={date}
      area={area}
      mapStyle={mapStyle}
      style={style}
    />
  );
});

export default RunShareImageTemplate;
