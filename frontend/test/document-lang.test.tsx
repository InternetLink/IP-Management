import {act, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it} from "vitest";

import {I18nProvider, type Locale, useI18n} from "../src/i18n";

function LocaleProbe() {
  const {locale, setLocale} = useI18n();

  return (
    <main>
      <p data-testid="locale">{locale}</p>
      <button type="button" onClick={() => setLocale("zh-TW")}>Switch to zh-TW</button>
      <button type="button" onClick={() => setLocale("en")}>Switch to en</button>
    </main>
  );
}

describe("document lang synchronization", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
  });

  it("keeps lang at the SSR-safe default on first render", async () => {
    render(<I18nProvider><LocaleProbe /></I18nProvider>);

    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("en"));
    expect(document.documentElement.lang).toBe("en");
  });

  it("updates document lang when the locale changes", async () => {
    render(<I18nProvider><LocaleProbe /></I18nProvider>);

    await act(async () => {
      screen.getByRole("button", {name: "Switch to zh-TW"}).click();
    });

    expect(screen.getByTestId("locale")).toHaveTextContent("zh-TW");
    expect(document.documentElement.lang).toBe("zh-TW");

    await act(async () => {
      screen.getByRole("button", {name: "Switch to en"}).click();
    });

    expect(document.documentElement.lang).toBe("en");
  });

  it("applies a persisted locale to document lang after mount", async () => {
    const persisted: Locale = "zh-TW";
    localStorage.setItem("ipam-locale", persisted);

    render(<I18nProvider><LocaleProbe /></I18nProvider>);

    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("zh-TW"));
    await waitFor(() => expect(document.documentElement.lang).toBe("zh-TW"));
  });
});
