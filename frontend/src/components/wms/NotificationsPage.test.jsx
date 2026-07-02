import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotificationsPage } from "./NotificationsPage";
import { clearStoredAuthToken, setStoredAuthToken } from "@/lib/portal-access";

function createUnsignedBrowserToken(payload) {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `e30.${encoded}.signature`;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>
  );
}

describe("NotificationsPage", () => {
  afterEach(() => {
    clearStoredAuthToken();
    vi.unstubAllGlobals();
  });

  it("renders notifications and the announcement form for system admins", async () => {
    setStoredAuthToken(createUnsignedBrowserToken({
      role: "System Admin",
      exp: Math.floor(Date.now() / 1000) + 60
    }));

    const fetchMock = vi.fn(async (input) => {
      const url = String(input);

      if (url.includes("/notifications?")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [{
              id: 21,
              notification_type: "warehouse_alert",
              title: "Bin capacity alert",
              message: "A bin in Warehouse A is full.",
              priority: "high",
              is_read: false,
              created_at: "2026-06-26T11:00:00.000Z"
            }]
          })
        };
      }

      if (url.endsWith("/roles")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [{ id: 1, role_name: "System Admin" }] })
        };
      }

      if (url.endsWith("/warehouses")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [{ id: 1, warehouse_name: "Warehouse A" }] })
        };
      }

      if (url.includes("/users?")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [{ id: 1, full_name: "Abdillah Ali" }] })
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    expect(await screen.findByText("Bin capacity alert")).toBeInTheDocument();
    expect(screen.getByText("Create System Announcement")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Announcement title")).toBeInTheDocument();
  });

  it("does not render the announcement form for staff", async () => {
    setStoredAuthToken(createUnsignedBrowserToken({
      role: "Warehouse Staff",
      exp: Math.floor(Date.now() / 1000) + 60
    }));

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);

      if (url.includes("/notifications?")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [] })
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    }));

    renderPage();

    expect(await screen.findByText("No notifications found")).toBeInTheDocument();
    expect(screen.queryByText("Create System Announcement")).not.toBeInTheDocument();
  });

  it("loads specific announcement users from backend role and warehouse filters", async () => {
    setStoredAuthToken(createUnsignedBrowserToken({
      role: "System Admin",
      exp: Math.floor(Date.now() / 1000) + 60
    }));

    const fetchMock = vi.fn(async (input) => {
      const url = String(input);

      if (url.includes("/notifications?")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [] })
        };
      }

      if (url.endsWith("/roles")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [{ id: 2, role_name: "Warehouse Staff" }] })
        };
      }

      if (url.endsWith("/warehouses")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [{ id: 1, warehouse_name: "Warehouse A" }] })
        };
      }

      if (url.includes("/users?")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [{
              id: 6,
              full_name: "Abdillah Ali",
              role_name: "Warehouse Staff",
              warehouse_name: "Warehouse A"
            }]
          })
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    expect(await screen.findByText("Create System Announcement")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("All roles"), { target: { value: "2" } });
    fireEvent.change(screen.getByDisplayValue("All warehouses"), { target: { value: "1" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/users?status=active&role_id=2&warehouse_id=1"),
        expect.any(Object)
      );
    });
    expect(await screen.findByText("Abdillah Ali - Warehouse Staff - Warehouse A")).toBeInTheDocument();
  });
});
