import { createContext, type ReactNode, useContext, useState } from "react";

type IncognitoValue = {
  incognito: boolean;
  toggle: () => void;
  setIncognito: (on: boolean) => void;
};

const IncognitoContext = createContext<IncognitoValue | null>(null);

export function IncognitoProvider({ children }: { children: ReactNode }) {
  const [incognito, setIncognito] = useState(false);
  return (
    <IncognitoContext.Provider
      value={{ incognito, setIncognito, toggle: () => setIncognito((v) => !v) }}
    >
      {children}
    </IncognitoContext.Provider>
  );
}

export function useIncognito(): IncognitoValue {
  const ctx = useContext(IncognitoContext);
  if (!ctx) throw new Error("IncognitoProvider is unavailable");
  return ctx;
}
