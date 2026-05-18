import React, { forwardRef } from "react";

import RunShareCard from "./RunShareCard";

const RunShareImageTemplate = forwardRef(function RunShareImageTemplate(
  {
    path = [],
    zoneCoords = [],
    isZone = false,
    title = "Wayper Run",
    subtitle = "Corrida",
    distance = "0.00 km",
    duration = "--:--",
    pace = "--:--/km",
    date = "",
    area = "0 m2",
    style,
  },
  ref
) {
  return (
    <RunShareCard
      ref={ref}
      mode="card"
      path={path}
      zoneCoords={zoneCoords}
      isZone={isZone}
      title={title}
      subtitle={subtitle}
      distance={distance}
      duration={duration}
      pace={pace}
      date={date}
      area={area}
      style={style}
    />
  );
});

export default RunShareImageTemplate;
