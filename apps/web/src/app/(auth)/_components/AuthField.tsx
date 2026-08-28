"use client";

import { cn } from "@kiakia/ui";
import { Check, Eye, EyeOff, type LucideIcon } from "lucide-react";
import { useId, useState, type InputHTMLAttributes } from "react";

/**
 * The one input the auth screens use.
 *
 * It replaces the previous arrangement — a bare @kiakia/ui <Input> plus a
 * ~40-selector `[&_input]:…` wall repeated in four layout components — with
 * a single styled control. Two consequences worth keeping: the accent colour
 * comes from --auth-accent (see auth.css) so customer red and vendor amber
 * need no prop, and the floating label is driven by :placeholder-shown
 * rather than React state, so autofill and bfcache restores can't desync it.
 */

interface AuthFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "placeholder" | "id"> {
  label: string;
  icon: LucideIcon;
  /** Small helper line under the field. */
  hint?: string;
  /** Rendered inside the field, right-aligned — e.g. a show/hide toggle. */
  action?: React.ReactNode;
}

export function AuthField({ label, icon: Icon, hint, action, className, ...props }: AuthFieldProps) {
  const id = useId();

  return (
    <div>
      <div className="group relative">
        <Icon
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 z-10 size-[18px] -translate-y-1/2 text-kk-cocoa/45 transition-colors group-focus-within:text-(--auth-accent)"
        />
        <input
          {...props}
          id={id}
          /* A single space, not "" — :placeholder-shown needs a placeholder
             to match against, and this one is never visible behind the
             resting label. */
          placeholder=" "
          className={cn(
            "kk-field-input peer h-[3.75rem] w-full rounded-2xl border border-kk-line/70 bg-kk-cream",
            "pb-2 pl-11 pr-4 pt-6 font-inter text-[15px] text-kk-ink outline-none",
            "transition-[border-color,box-shadow,background-color] duration-200",
            "hover:border-kk-line",
            "focus:border-(--auth-accent) focus:bg-white",
            "focus:shadow-[0_0_0_4px_rgb(var(--auth-accent-glow)/0.12)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        />
        <label
          htmlFor={id}
          className="kk-field-label pointer-events-none absolute left-11 top-[1.125rem] font-inter text-[15px] leading-6 text-kk-cocoa/70"
        >
          {label}
        </label>
        {action ? <div className="absolute right-3 top-1/2 -translate-y-1/2">{action}</div> : null}
      </div>
      {hint ? <p className="mt-1.5 pl-1 font-inter text-xs text-kk-cocoa/60">{hint}</p> : null}
    </div>
  );
}

/**
 * AuthField plus a show/hide toggle, and — when `strength` is set — a live
 * four-state meter. The meter is advisory only; registerSchema on the server
 * remains the authority on what actually passes.
 */
export function AuthPasswordField({
  label,
  icon,
  hint,
  strength = false,
  onChange,
  ...props
}: AuthFieldProps & { strength?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");

  return (
    <div>
      <AuthField
        {...props}
        label={label}
        icon={icon}
        hint={strength ? undefined : hint}
        type={visible ? "text" : "password"}
        className="pr-12"
        onChange={(e) => {
          setValue(e.currentTarget.value);
          onChange?.(e);
        }}
        action={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="flex size-9 items-center justify-center rounded-xl text-kk-cocoa/55 transition-colors hover:bg-kk-sand hover:text-kk-ink"
            aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          >
            {visible ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        }
      />
      {strength ? <PasswordStrength value={value} hint={hint} /> : null}
    </div>
  );
}

/** Mirrors the three rules registerSchema enforces, so the meter can't
 *  promise a password the server will reject. */
const RULES = [
  { label: "8+ characters", test: (v: string) => v.length >= 8 },
  { label: "a letter", test: (v: string) => /[a-zA-Z]/.test(v) },
  { label: "a number", test: (v: string) => /\d/.test(v) },
] as const;

const TONES = [
  { bar: "bg-kk-line", text: "text-kk-cocoa/60", word: "Too short" },
  { bar: "bg-danger", text: "text-danger", word: "Weak" },
  { bar: "bg-kk-orange", text: "text-kk-orange-deep", word: "Almost" },
  { bar: "bg-kk-green", text: "text-kk-green", word: "Strong" },
] as const;

function PasswordStrength({ value, hint }: { value: string; hint?: string }) {
  const score = value.length === 0 ? 0 : RULES.filter((r) => r.test(value)).length;
  const tone = TONES[score] ?? TONES[0];

  if (value.length === 0) {
    return hint ? <p className="mt-1.5 pl-1 font-inter text-xs text-kk-cocoa/60">{hint}</p> : null;
  }

  return (
    <div className="mt-2 pl-1">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {RULES.map((rule, i) => (
            <span
              key={rule.label}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-300",
                i < score ? tone.bar : "bg-kk-line/50",
              )}
            />
          ))}
        </div>
        <span className={cn("font-inter text-[11px] font-semibold", tone.text)}>{tone.word}</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {RULES.map((rule) => {
          const ok = rule.test(value);
          return (
            <li
              key={rule.label}
              className={cn(
                "flex items-center gap-1 font-inter text-[11px]",
                ok ? "text-kk-green" : "text-kk-cocoa/55",
              )}
            >
              <Check className={cn("size-3 shrink-0", ok ? "opacity-100" : "opacity-25")} />
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
