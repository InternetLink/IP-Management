import {render, screen, waitFor} from "@testing-library/react";
import {describe, expect, it} from "vitest";

import {I18nProvider, useI18n} from "../src/i18n";
import {AuthProvider, useAuth} from "../src/lib/auth";

import {runAxe} from "./axe";

function AppProviders({children}: {children: React.ReactNode}) {
  return (
    <I18nProvider>
      <AuthProvider>{children}</AuthProvider>
    </I18nProvider>
  );
}

function ProviderProbe() {
  const {locale} = useI18n();
  const {loading, user} = useAuth();

  return (
    <main aria-labelledby="provider-heading">
      <h1 id="provider-heading">Provider smoke</h1>
      <p data-testid="locale">Locale: {locale}</p>
      <p>{loading ? "Loading" : user ? `Signed in as ${user.username}` : "Signed out"}</p>
    </main>
  );
}

describe("application providers", () => {
  it("renders the required i18n and auth context tree", async () => {
    const {container} = render(
      <AppProviders>
        <ProviderProbe />
      </AppProviders>,
    );

    expect(screen.getByRole("heading", {name: "Provider smoke"})).toBeInTheDocument();
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    await waitFor(() => expect(screen.getByText("Signed out")).toBeInTheDocument());

    const results = await runAxe(container);
    const seriousViolations = results.violations.filter(({impact}) => impact === "serious" || impact === "critical");
    expect(seriousViolations).toEqual([]);
  });
});
