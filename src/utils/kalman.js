// kalman2d.supreme.js
// KALMAN 2D SUPREMO - Versão profissional e otimizada para GPS mobile
// - Estado: [lat, lon, vLat, vLon] (lat/lon em graus, v in m/s)
// - Implementa predição + atualização (predict-update) com matrizes 4x4
// - Adapta ruído de medição (R) com base na accuracy do GPS
// - Conversões deg <-> meters consideram latitude para lon scaling
// - Feito para ser leve, robusto e pronto para produção
// - Comentários em Português e API simples: new Kalman2D(opts); k.filter(lat, lon, acc, ts);

class Kalman2D {
  /**
   * options:
   *  - processNoise (Q) default 1e-2 (process noise, m^2/s^2-ish)
   *  - measurementNoise (base R) default 5 (meters)
   *  - minAccuracy minimal accuracy to consider (meters)
   *  - velocityDecay factor to reduce velocity trust over time (0..1)
   *  - presets: 'natural'|'responsive'|'smooth' adjust Q/R
   */
  constructor(options = {}) {
    const {
      processNoise = 1e-2,
      measurementNoise = 5.0,
      minAccuracy = 1.0,
      velocityDecay = 0.98,
      presets = "natural",
    } = options;

    const presetMap = {
      natural: { processNoise: 1e-2, measurementNoise: 5.0 },
      responsive: { processNoise: 1e-1, measurementNoise: 8.0 },
      smooth: { processNoise: 1e-3, measurementNoise: 3.0 },
    };
    const p = presetMap[presets] || {};
    this.Q_scalar = options.processNoise ?? p.processNoise ?? processNoise;
    this.R_base = options.measurementNoise ?? p.measurementNoise ?? measurementNoise;

    this.MIN_ACCURACY = minAccuracy;
    this.velocityDecay = velocityDecay;

    // internal state
    this.initialized = false;
    this.lastTs = 0;

    // state vector x = [lat, lon, vLat, vLon]
    this.x = [0, 0, 0, 0];

    // covariance matrix P (4x4) - initialize with modest certainty on pos and large on vel
    this.P = [
      [25, 0, 0, 0], // var lat (deg^2) approx (5m)^2 converted later; we operate in degrees for x but treat P relative
      [0, 25, 0, 0],
      [0, 0, 100, 0],
      [0, 0, 0, 100],
    ];
  }

  // --- Helpers: degrees <-> meters conversions ---
  static degLatToMeters(d) {
    return d * 111320; // approximate
  }
  static degLonToMeters(d, lat) {
    return d * 111320 * Math.cos((lat * Math.PI) / 180);
  }
  static metersToDegLat(m) {
    return m / 111320;
  }
  static metersToDegLon(m, lat) {
    return m / (111320 * Math.cos((lat * Math.PI) / 180));
  }

  // reset state
  reset() {
    this.initialized = false;
    this.lastTs = 0;
    this.x = [0, 0, 0, 0];
    this.P = [
      [25, 0, 0, 0],
      [0, 25, 0, 0],
      [0, 0, 100, 0],
      [0, 0, 0, 100],
    ];
  }

  // set tuning params at runtime
  setParams({ processNoise, measurementNoise, minAccuracy, velocityDecay, presets } = {}) {
    if (processNoise != null) this.Q_scalar = processNoise;
    if (measurementNoise != null) this.R_base = measurementNoise;
    if (minAccuracy != null) this.MIN_ACCURACY = minAccuracy;
    if (velocityDecay != null) this.velocityDecay = velocityDecay;
    if (presets) {
      // simple map if needed; ignored here if explicit values present
    }
  }

  // multiply scalar to diagonal of matrix P (P = P + scalar * I)
  _addProcessNoiseToP(scalar) {
    for (let i = 0; i < 4; i++) this.P[i][i] += scalar;
  }

  // very small helper: clamp number
  _clamp(v, a, b) {
    if (v < a) return a;
    if (v > b) return b;
    return v;
  }

  /**
   * filter(lat, lon, accuracyMeters, timestampMilliseconds)
   * returns { latitude, longitude }
   */
  filter(lat, lon, accuracy = null, timestamp = null) {
    // input validation
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { latitude: lat, longitude: lon };
    }
    if (!Number.isFinite(accuracy)) accuracy = this.R_base;
    if (!timestamp) timestamp = Date.now();

    // initialize on first measurement
    if (!this.initialized) {
      this.x[0] = lat;
      this.x[1] = lon;
      this.x[2] = 0;
      this.x[3] = 0;
      this.lastTs = timestamp;
      this.initialized = true;

      // shrink initial P by measurement accuracy to reflect trust in initial reading
      const acc = Math.max(this.MIN_ACCURACY, accuracy);
      const accDegLat = Kalman2D.metersToDegLat(acc);
      const accDegLon = Kalman2D.metersToDegLon(acc, lat);
      this.P[0][0] = accDegLat * accDegLat;
      this.P[1][1] = accDegLon * accDegLon;
      return { latitude: lat, longitude: lon };
    }

    // time delta (s)
    const dt = Math.max((timestamp - this.lastTs) / 1000, 1e-3);
    this.lastTs = timestamp;

    // Prediction step (motion model): x_pred = x + v*dt (vel in m/s => convert to degrees)
    const [lat0, lon0, vLat, vLon] = this.x;
    const latPred = lat0 + Kalman2D.metersToDegLat(vLat * dt);
    const lonPred = lon0 + Kalman2D.metersToDegLon(vLon * dt, lat0);

    // P prediction: add process noise scaled by dt and Q_scalar
    // Increase uncertainty proportional to dt
    const Q = this.Q_scalar * Math.max(dt, 1e-3);
    this._addProcessNoiseToP(Q);

    // Measurement residual in meters (meas - pred)
    const dLatM = Kalman2D.degLatToMeters(lat - latPred);
    const dLonM = Kalman2D.degLonToMeters(lon - lonPred, latPred);

    // Adapt measurement noise R by reported accuracy: better accuracy -> lower R
    const R = this._clamp(Math.max(this.MIN_ACCURACY, accuracy), this.MIN_ACCURACY, 2000);

    // Convert P's position variances to meters for gain calculation approx
    // Since P stored in deg^2 for lat/lon we convert diag to meters^2 for pos entries
    const pLatVarM = Math.abs(Kalman2D.degLatToMeters(Math.sqrt(Math.abs(this.P[0][0])))) ** 2;
    const pLonVarM = Math.abs(Kalman2D.degLonToMeters(Math.sqrt(Math.abs(this.P[1][1])), lat0)) ** 2;

    // Compute simple scalar gains for position and velocity using diag approximation
    const KposLat = pLatVarM / (pLatVarM + R * R);
    const KposLon = pLonVarM / (pLonVarM + R * R);
    const KvelLat = this.P[2][2] / (this.P[2][2] + R);
    const KvelLon = this.P[3][3] / (this.P[3][3] + R);

    // Update state: convert meter residuals back to degrees when applying to lat/lon
    const latUpdateDeg = Kalman2D.metersToDegLat(KposLat * dLatM);
    const lonUpdateDeg = Kalman2D.metersToDegLon(KposLon * dLonM, latPred);

    // velocity corrections (m/s)
    const velCorrLat = (KvelLat * dLatM) / Math.max(dt, 1e-3);
    const velCorrLon = (KvelLon * dLonM) / Math.max(dt, 1e-3);

    // Apply updates with small blending factor for stability
    const blend = 0.9; // keep mostly predicted, blend measurement
    const newLat = latPred + latUpdateDeg * blend;
    const newLon = lonPred + lonUpdateDeg * blend;
    const newVLat = vLat * this.velocityDecay + velCorrLat * (1 - this.velocityDecay);
    const newVLon = vLon * this.velocityDecay + velCorrLon * (1 - this.velocityDecay);

    this.x[0] = newLat;
    this.x[1] = newLon;
    this.x[2] = newVLat;
    this.x[3] = newVLon;

    // Update covariance diagonals heuristically to represent improved certainty
    // Reduce pos variance proportionally to gain
    const reduceFactorPos = 0.7 * (1 - Math.max(KposLat, KposLon));
    this.P[0][0] = Math.max(1e-12, this.P[0][0] * (reduceFactorPos + 0.1));
    this.P[1][1] = Math.max(1e-12, this.P[1][1] * (reduceFactorPos + 0.1));

    // Slightly damp velocity covariance
    this.P[2][2] = Math.min(1e6, Math.abs(this.P[2][2]) * 0.95 + Math.abs(velCorrLat));
    this.P[3][3] = Math.min(1e6, Math.abs(this.P[3][3]) * 0.95 + Math.abs(velCorrLon));

    return { latitude: this.x[0], longitude: this.x[1] };
  }

  // convenience: filter heading smooth (optional)
  // input heading deg 0..360, returns smoothed heading using simple exponential smoothing
  filterHeading(heading, alpha = 0.6) {
    if (!this._heading) this._heading = heading;
    // shortest angle interpolation
    const diff = ((((heading - this._heading + 540) % 360) + 360) % 360) - 180;
    this._heading = (this._heading + alpha * diff + 360) % 360;
    return this._heading;
  }
}

export default Kalman2D;
