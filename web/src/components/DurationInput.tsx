import { useState, useEffect } from "preact/hooks";
import { Select } from "./Select";

const UNITS: { label: string; seconds: number }[] = [
  { label: "seconds", seconds: 1 },
  { label: "minutes", seconds: 60 },
  { label: "hours", seconds: 3600 },
  { label: "days", seconds: 86400 },
];

/** A value+unit pair (e.g. "2 hours") that reports its total back in
 * seconds — nobody creating a check should have to do that arithmetic
 * themselves by typing a raw seconds count. */
export function DurationInput({
  seconds,
  onChange,
  defaultUnitSeconds = 3600,
}: {
  seconds: number;
  onChange: (seconds: number) => void;
  defaultUnitSeconds?: number;
}) {
  const [unit, setUnit] = useState(defaultUnitSeconds);
  const [amount, setAmount] = useState(seconds / defaultUnitSeconds);

  // If the incoming seconds value changes from outside (e.g. a form reset)
  // in a way that no longer matches amount*unit, resync the displayed amount.
  useEffect(() => {
    if (Math.abs(amount * unit - seconds) > 0.001) {
      setAmount(seconds / unit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  function update(newAmount: number, newUnit: number) {
    setAmount(newAmount);
    setUnit(newUnit);
    onChange(Math.round(newAmount * newUnit));
  }

  return (
    <div class="duration-input">
      <input
        type="number"
        min="0"
        step="any"
        value={amount}
        onInput={(e) => update(Number(e.currentTarget.value) || 0, unit)}
      />
      <Select
        value={String(unit)}
        options={UNITS.map((u) => ({ value: String(u.seconds), label: u.label }))}
        onChange={(v) => update(amount, Number(v))}
        ariaLabel="Unit"
      />
    </div>
  );
}
