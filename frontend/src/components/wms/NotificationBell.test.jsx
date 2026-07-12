import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotificationBell } from "./NotificationBell";
import { clearStoredAuthToken, setStoredAuthToken } from "@/lib/portal-access";

function createUnsignedBrowserToken(payload) {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `e30.${encoded}.signature`;
}

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>
  );
}

describe("NotificationBell", () => {
  afterEach(() => {
    clearStoredAuthToken();
    vi.unstubAllGlobals();
  });

  it("hides when no user is authenticated", () => {
    vi.stubGlobal("fetch", vi.fn());

    const { container } = renderBell();

    expect(container).toBeEmptyDOMElement();
  });

  it("shows unread count, loads notifications, and marks an item read", async () => {
    setStoredAuthToken(createUnsignedBrowserToken({
      role: "Warehouse Staff",
      exp: Math.floor(Date.now() / 1000) + 60
    }));

    let notificationRead = false;
    const notification = {
      id: 11,
      public_reference: "NTF-2026-TEST",
      notification_type: "pending_approval",
      title: "Cargo registration needs review",
      message: "CARGO-2026-0001 is waiting for supervisor review.",
      priority: "normal",
      is_read: false,
      created_at: "2026-06-26T10:15:00.000Z",
      related_entity_type: "cargo",
      related_entity_id: 101,
      related_cargo_identifier: "CARGO-2026-0001"
    };

    const fetchMock = vi.fn(async (input, options = {}) => {
      const url = String(input);

      if (url.includes("/notifications/unread-count")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { count: notificationRead ? 0 : 3 } })
        };
      }

      if (url.includes("/notifications?")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: notificationRead ? [] : [notification] })
        };
      }

      if (url.includes("/notifications/NTF-2026-TEST/read") && options.method === "PATCH") {
        notificationRead = true;
        return {
          ok: true,
          json: async () => ({ success: true, data: { ...notification, is_read: true } })
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderBell();

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/notifications?read=false&limit=5"),
      expect.any(Object)
    );

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(await screen.findByText("Cargo registration needs review")).toBeInTheDocument();
    expect(screen.getByText("Pending Approval")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /mark as read/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/notifications/NTF-2026-TEST/read"),
        expect.objectContaining({ method: "PATCH" })
      );
    });
    expect(await screen.findByText("No unread notifications.")).toBeInTheDocument();
  });
});
