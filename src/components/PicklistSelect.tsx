import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLovValues, type LovOption } from "../lib/mprCalendars";

type Props = {
  supabase: SupabaseClient;
  listCode: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
};

export function PicklistSelect({ supabase, listCode, value, onChange, required }: Props) {
  const [options, setOptions] = useState<LovOption[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setOptions(null);
    setError("");
    getLovValues(supabase, listCode)
      .then(rows => { if (current) setOptions(rows); })
      .catch(() => { if (current) setError("Could not load dropdown options. Reopen the form to retry."); });
    return () => { current = false; };
  }, [supabase, listCode]);

  return <>
    <select required={required} value={value} onChange={event => onChange(event.target.value)}>
      <option value="" disabled={required}>
        {options ? (required ? "Select an option" : "None") : error ? "Options unavailable" : "Loading options"}
      </option>
      {value && !options?.some(option => option.value_code === value) && (
        <option value={value}>{value}{options ? " (saved value)" : ""}</option>
      )}
      {options?.map(option => (
        <option key={option.value_code} value={option.value_code}>{option.display_label}</option>
      ))}
    </select>
    {error && <small role="alert">{error}</small>}
  </>;
}
