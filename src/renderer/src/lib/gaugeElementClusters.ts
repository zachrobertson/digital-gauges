import type { GaugeElement, LayoutRect } from '@shared/types/gaugeElement';
import type { TelemetryField } from '@shared/types';
import {
  createArcElement,
  createTextReadoutElement,
} from './gaugeElementFactory';

export type ElementClusterKind = 'speed-readout' | 'power-dial' | 'metric-row';

export function createCluster(
  kind: ElementClusterKind,
  gaugeRect: LayoutRect,
  field: TelemetryField = 'speed',
): { elements: GaugeElement[]; groupId: string } {
  const groupId = crypto.randomUUID();
  const cx = gaugeRect.x + gaugeRect.w * 0.5;
  const cy = gaugeRect.y + gaugeRect.h * 0.55;

  switch (kind) {
    case 'speed-readout': {
      const arc = createArcElement(gaugeRect, field);
      const text = createTextReadoutElement(gaugeRect, field);
      return {
        groupId,
        elements: [
          {
            ...arc,
            groupId,
            center: { x: cx, y: cy },
            radius: Math.round(Math.min(gaugeRect.w, gaugeRect.h) * 0.32),
          },
          {
            ...text,
            groupId,
            value: {
              ...text.value,
              pos: { x: cx, y: cy + Math.round(Math.min(gaugeRect.w, gaugeRect.h) * 0.22) },
            },
            unit: {
              ...text.unit,
              pos: { x: cx, y: cy + Math.round(Math.min(gaugeRect.w, gaugeRect.h) * 0.38) },
            },
          },
        ],
      };
    }
    case 'power-dial': {
      const arc = createArcElement(gaugeRect, field === 'speed' ? 'power' : field);
      const text = createTextReadoutElement(gaugeRect, arc.field);
      return {
        groupId,
        elements: [
          {
            ...arc,
            groupId,
            field: 'power',
            center: { x: cx, y: cy },
            radius: Math.round(Math.min(gaugeRect.w, gaugeRect.h) * 0.34),
            startDeg: 210,
            endDeg: 330,
          },
          {
            ...text,
            groupId,
            field: 'power',
            value: {
              ...text.value,
              pos: { x: cx, y: cy + 8 },
              fontSize: 28,
            },
            unit: {
              ...text.unit,
              pos: { x: cx, y: cy + 32 },
            },
          },
        ],
      };
    }
    case 'metric-row': {
      const fields: TelemetryField[] = ['speed', 'hr', 'cadence'];
      const rowY = gaugeRect.y + gaugeRect.h * 0.5;
      const slotW = gaugeRect.w / fields.length;
      const elements = fields.map((f, i) => {
        const text = createTextReadoutElement(gaugeRect, f);
        const slotCx = gaugeRect.x + slotW * (i + 0.5);
        return {
          ...text,
          groupId,
          value: {
            ...text.value,
            pos: { x: slotCx, y: rowY - 6 },
            fontSize: 24,
          },
          unit: {
            ...text.unit,
            pos: { x: slotCx, y: rowY + 14 },
            fontSize: 10,
          },
        };
      });
      return { groupId, elements };
    }
  }
}
