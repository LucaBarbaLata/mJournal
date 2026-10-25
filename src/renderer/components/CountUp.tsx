/** A number that counts up to its value (shown instantly with reduced motion). */
import { useCountUp } from '../lib/motion';

export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const shown = useCountUp(value);
  const text = decimals > 0 ? shown.toFixed(decimals) : Math.round(shown).toLocaleString('en');
  return (
    <>
      <span aria-hidden="true">{text}</span>
      <span className="visually-hidden">{decimals > 0 ? value.toFixed(decimals) : value.toLocaleString('en')}</span>
    </>
  );
}
