import { useEffect, useRef, useState } from "preact/hooks";

interface Option {
  value: string;
  label: string;
}

/**
 * A fully custom listbox-button dropdown — not a styled-in-place native
 * <select>. Native selects can't be themed consistently across browsers
 * (the popup itself is OS-drawn), which is exactly why the old one looked
 * like unstyled scaffolding against a dark panel. This implements the
 * WAI-ARIA "listbox button" pattern by hand: button opens/closes a
 * roving-focus listbox, arrow keys move selection, typeahead jumps to a
 * matching label, Escape/outside-click closes it.
 *
 * Animates in/out via a three-phase mount state (mounted → open → closed)
 * rather than a plain conditional render, so closing gets a real exit
 * transition instead of vanishing instantly — a conditional `{open && …}`
 * can only ever animate the *opening* half.
 */
export function Select({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef("");
  const typeaheadTimer = useRef<number | undefined>(undefined);

  const selected = options.find((o) => o.value === value) ?? options[0];

  function open() {
    setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)));
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
  }

  function close() {
    setEntered(false);
    window.setTimeout(() => setMounted(false), 150);
  }

  function commit(index: number) {
    const opt = options[index];
    if (opt) onChange(opt.value);
    close();
  }

  useEffect(() => {
    if (entered) listRef.current?.focus();
  }, [entered]);

  useEffect(() => {
    if (!mounted) return;
    function onDocPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [mounted]);

  function onListKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(activeIndex);
    } else if (e.key === "Tab") {
      close();
    } else if (e.key.length === 1) {
      typeahead.current += e.key.toLowerCase();
      window.clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = window.setTimeout(() => (typeahead.current = ""), 600);
      const idx = options.findIndex((o) => o.label.toLowerCase().startsWith(typeahead.current));
      if (idx >= 0) setActiveIndex(idx);
    }
  }

  return (
    <div class="ui-select" ref={rootRef}>
      <button
        type="button"
        class="ui-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={mounted}
        aria-label={ariaLabel}
        onClick={() => (mounted ? close() : open())}
      >
        <span>{selected?.label}</span>
        <svg class="ui-select-chevron" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M3 5.5 7 9.5 11 5.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      {mounted && (
        <ul
          class={`ui-select-list${entered ? " is-open" : ""}`}
          role="listbox"
          ref={listRef}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              class={`ui-select-option${i === activeIndex ? " is-active" : ""}${
                o.value === value ? " is-selected" : ""
              }`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => commit(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
