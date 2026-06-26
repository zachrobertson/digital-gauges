/** Gradual multi-stop fill gradient for bar/arc gauges (0 = min, 1 = max). */

export interface FillGradientStop {
  pos: number;
  color: string;
}

export interface FillGradientConfig {
  enabled: boolean;
  stops: FillGradientStop[];
}
