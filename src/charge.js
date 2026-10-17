// Charge is a survival resource, independent of cold-gas thruster pressure.
export const CHARGE = Object.freeze({
  drainPerSecond:1/40,
  perOrb:.055,
  orbsPerArc:6,
  lowThreshold:.23,
  firstArcWindow:[10,15],
  repeatArcWindow:[7.8,10.6]
});
