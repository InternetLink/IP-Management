import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {useState} from "react";
import {describe, expect, it} from "vitest";

import {Button} from "@heroui/react";

import {Dialog} from "../src/components/dialog";

import {runAxe} from "./axe";

function seriousViolations(results: Awaited<ReturnType<typeof runAxe>>) {
  return results.violations.filter(({impact}) => impact === "serious" || impact === "critical");
}

function FormDialogHarness() {
  const [open, setOpen] = useState(false);

  return (
    <main>
      <h1>Dialog harness</h1>
      <button type="button" onClick={() => setOpen(true)}>Open form dialog</button>
      <Dialog
        descriptionText="Split this prefix into smaller sub-prefixes."
        footer={<>
          <Button variant="ghost" onPress={() => setOpen(false)}>Cancel</Button>
          <Button onPress={() => setOpen(false)}>Confirm split</Button>
        </>}
        isOpen={open}
        title="Split: 10.0.0.0/22"
        onClose={() => setOpen(false)}
      >
        <label htmlFor="new-prefix-length">New prefix length</label>
        <input id="new-prefix-length" type="number" />
      </Dialog>
    </main>
  );
}

function ConfirmDialogHarness() {
  const [open, setOpen] = useState(false);

  return (
    <main>
      <h1>Confirm harness</h1>
      <button type="button" onClick={() => setOpen(true)}>Open confirm dialog</button>
      <Dialog
        footer={<>
          <Button variant="ghost" onPress={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" onPress={() => setOpen(false)}>Delete</Button>
        </>}
        isOpen={open}
        title="Confirm Delete"
        onClose={() => setOpen(false)}
      >
        <p>This will permanently delete this prefix and all its children: 10.0.0.0/22</p>
      </Dialog>
    </main>
  );
}

async function openDialog(triggerName: string) {
  const trigger = screen.getByRole("button", {name: triggerName}) as HTMLElement;
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog");
  // Let the react-aria focus scope settle before asserting focus behaviour.
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return {dialog, trigger};
}

describe("Dialog wrapper accessibility", () => {
  it("labels the dialog from its heading and places initial focus inside", async () => {
    render(<FormDialogHarness />);
    const {dialog} = await openDialog("Open form dialog");

    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const heading = document.getElementById(labelledBy as string);
    expect(heading?.textContent).toBe("Split: 10.0.0.0/22");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("locks background scrolling while open and releases it on close", async () => {
    render(<FormDialogHarness />);
    await openDialog("Open form dialog");
    expect(document.documentElement.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.documentElement.style.overflow).not.toBe("hidden"));
  });

  it("keeps Tab focus cycling inside the open dialog", async () => {
    render(<FormDialogHarness />);
    const {dialog} = await openDialog("Open form dialog");

    const input = screen.getByLabelText("New prefix length");
    const cancel = screen.getByRole("button", {name: "Cancel"});
    const confirm = screen.getByRole("button", {name: "Confirm split"});

    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(document.activeElement as Element, {key: "Tab"});
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(document.activeElement as Element, {key: "Tab"});
    expect(document.activeElement).toBe(confirm);

    // Tabbing past the last focusable element wraps back into the dialog
    // instead of escaping to the page behind it.
    fireEvent.keyDown(document.activeElement as Element, {key: "Tab"});
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(screen.getByRole("button", {name: "Open form dialog", hidden: true}));

    // Shift+Tab from the first element also stays contained.
    input.focus();
    fireEvent.keyDown(document.activeElement as Element, {key: "Tab", shiftKey: true});
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape", async () => {
    render(<FormDialogHarness />);
    const {dialog} = await openDialog("Open form dialog");

    fireEvent.keyDown(dialog, {code: "Escape", key: "Escape"});
    fireEvent.keyUp(dialog, {code: "Escape", key: "Escape"});

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("restores focus to the triggering element after close", async () => {
    render(<ConfirmDialogHarness />);
    const {trigger} = await openDialog("Open confirm dialog");

    fireEvent.click(screen.getByRole("button", {name: "Delete"}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("has no serious or critical axe violations while a form dialog is open", async () => {
    render(<FormDialogHarness />);
    const {dialog} = await openDialog("Open form dialog");

    expect(seriousViolations(await runAxe(dialog))).toEqual([]);
  });

  it("has no serious or critical axe violations while a destructive confirmation is open", async () => {
    render(<ConfirmDialogHarness />);
    const {dialog} = await openDialog("Open confirm dialog");

    expect(seriousViolations(await runAxe(dialog))).toEqual([]);
  });
});
