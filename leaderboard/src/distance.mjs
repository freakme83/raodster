import { CONFIG, speedAt } from '../../src/physics.js';

const STEP = CONFIG.step;
const SPEED_LIMIT = 80;
const EXACT_SECONDS = 600;
const EXACT_STEPS = Math.ceil(EXACT_SECONDS / STEP);
const prefix = new Float64Array(EXACT_STEPS + 1);

for (let step = 1; step <= EXACT_STEPS; step += 1) {
  prefix[step] = prefix[step - 1] + speedAt(step * STEP) * STEP;
}

// speedAt(600) has reached its 80 m/s floating-point ceiling. The tail uses
// that ceiling, avoiding millions of iterations for a legitimate long run.
export function maximumDistance(elapsedMs, toleranceMs = 1000) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 ||
      !Number.isFinite(toleranceMs) || toleranceMs < 0) {
    throw new RangeError('Elapsed time and tolerance must be finite and nonnegative');
  }

  // An extra step covers a timestamp exactly on a simulation boundary.
  const steps = Math.ceil(((elapsedMs + toleranceMs) / 1000) / STEP) + 1;
  const exact = Math.min(steps, EXACT_STEPS);
  const tail = Math.max(0, steps - EXACT_STEPS) * SPEED_LIMIT * STEP;

  // The game adds each step to a running double. Its cumulative rounding may
  // differ slightly from this prefix plus tail, especially on a 72-hour run.
  return prefix[exact] + tail + 0.5;
}

export const distancePolicy = Object.freeze({ stepSeconds: STEP, speedLimit: SPEED_LIMIT, exactSeconds: EXACT_SECONDS, floatingPointAllowanceMetres: 0.5 });
