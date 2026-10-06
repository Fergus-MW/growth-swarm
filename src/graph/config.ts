export const COSMOS_VERSION = "3.5.0";
export const SPACE_SIZE = 2048;

export interface CosmosMountConfig {
  backgroundColor: string;
  spaceSize: number;
  simulationCollision: number;
  randomSeed: number;
  rescalePositions: false;
  fitViewOnInit: false;
  transitionDuration: number;
  scalePointsOnZoom: false;
  scaleLinksOnZoom: false;
  pixelRatio: number;
  enableSimulation: boolean;
}

/** Library default forces stay unset. Collision is off. Pixel ratio is capped at 1.5. */
export function cosmosMountConfig(input: { pixelRatio: number; reducedMotion: boolean; backgroundColor?: string }): CosmosMountConfig {
  const ratio = Number.isFinite(input.pixelRatio) && input.pixelRatio > 0 ? input.pixelRatio : 1;
  return {
    backgroundColor: input.backgroundColor ?? "#10130f",
    spaceSize: SPACE_SIZE,
    simulationCollision: 0,
    randomSeed: 1,
    rescalePositions: false,
    fitViewOnInit: false,
    transitionDuration: 0,
    scalePointsOnZoom: false,
    scaleLinksOnZoom: false,
    pixelRatio: Math.min(ratio, 1.5),
    enableSimulation: !input.reducedMotion,
  };
}
