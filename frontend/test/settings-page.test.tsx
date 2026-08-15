import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    auth: {changePassword: mocks.changePassword},
    settings: {get: mocks.getSettings, update: mocks.updateSettings},
  },
}));

import {SettingsPage} from "../src/views/settings-page";

const loadedSettings = {
  asn: "AS64512",
  contactEmail: "noc@loaded.example",
  defaultCountryCode: "DE",
  defaultRIR: "RIPE NCC",
  expiryWarningDays: 17,
  geofeedAutoASN: false,
  geofeedHeader: "# Loaded geofeed header",
  geofeedPublicUrl: "https://loaded.example/geofeed.csv",
  organizationName: "Loaded Network",
  utilizationThreshold: 73,
  version: "settings-version-1",
} as const;

describe("SettingsPage request safety", () => {
  beforeEach(() => {
    mocks.changePassword.mockReset();
    mocks.getSettings.mockReset();
    mocks.updateSettings.mockReset();
  });

  it("keeps Save disabled and exposes retry when loading fails", async () => {
    mocks.getSettings
      .mockRejectedValueOnce(new Error("Settings API unavailable"))
      .mockResolvedValueOnce(loadedSettings);

    render(<SettingsPage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Settings API unavailable");
    const saveButton = screen.getByRole("button", {name: "Save changes"}) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    fireEvent.click(saveButton);
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {name: "Retry"}));
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(saveButton.disabled).toBe(false));
  });

  it("resets local edits to the exact last loaded snapshot", async () => {
    mocks.getSettings.mockResolvedValue(loadedSettings);
    mocks.updateSettings.mockResolvedValue({...loadedSettings, version: "settings-version-2"});

    render(<SettingsPage />);

    const organizationInput = await screen.findByDisplayValue("Loaded Network") as HTMLInputElement;
    const expiryInput = screen.getByDisplayValue("17") as HTMLInputElement;
    const includeAsn = screen.getByRole("checkbox") as HTMLInputElement;
    expect(includeAsn.checked).toBe(false);

    fireEvent.change(organizationInput, {target: {value: "Unsaved Network"}});
    fireEvent.change(expiryInput, {target: {value: "99"}});
    fireEvent.click(includeAsn);
    expect(organizationInput.value).toBe("Unsaved Network");
    expect(expiryInput.value).toBe("99");
    expect(includeAsn.checked).toBe(true);

    const resetButton = screen.getByRole("button", {name: "Reset"}) as HTMLButtonElement;
    expect(resetButton.type).toBe("button");
    fireEvent.click(resetButton);

    expect(organizationInput.value).toBe("Loaded Network");
    expect(expiryInput.value).toBe("17");
    expect(includeAsn.checked).toBe(false);

    fireEvent.click(screen.getByRole("button", {name: "Save changes"}));
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      expiryWarningDays: 17,
      geofeedAutoASN: false,
      organizationName: "Loaded Network",
    }));
  });

  it("saves with the version from a successful load", async () => {
    mocks.getSettings.mockResolvedValue(loadedSettings);
    mocks.updateSettings.mockResolvedValue({...loadedSettings, version: "settings-version-2"});

    render(<SettingsPage />);
    const saveButton = await screen.findByRole("button", {name: "Save changes"}) as HTMLButtonElement;
    await waitFor(() => expect(saveButton.disabled).toBe(false));

    fireEvent.click(saveButton);

    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: "settings-version-1",
      organizationName: "Loaded Network",
    }));
  });
});
