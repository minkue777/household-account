/** @jest-environment node */
import { renderToString } from 'react-dom/server';
import { useChartMotion } from '@/components/common/useChartMotion';

it('renders statistics on the server without accessing browser globals', () => {
  function ChartOptionsProbe() {
    const options = useChartMotion();
    return <output>{options.animation === false ? 'reduced' : options.animation.duration}</output>;
  }
  expect(renderToString(<ChartOptionsProbe />)).toBe('<output>150</output>');
});
