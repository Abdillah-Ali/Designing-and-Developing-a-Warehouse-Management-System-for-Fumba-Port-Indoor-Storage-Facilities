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

      if (url.endsWith("/notifications/summary")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { active: 1, unread: 1, archived: 0 } })
        };
      }

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
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Announcement" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Announcement title")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create Announcement" }));

    expect(await screen.findByText("Create System Announcement")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Announcement title")).toBeInTheDocument();
  });

  it("does not render the announcement form for staff", async () => {
    setStoredAuthToken(createUnsignedBrowserToken({
      role: "Warehouse Staff",
      exp: Math.floor(Date.now() / 1000) + 60
    }));

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);

      if (url.endsWith("/notifications/summary")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { active: 0, unread: 0, archived: 0 } })
        };
      }

      if (url.includes("/notifications?")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [] })
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    }));

    renderPage();

    expect(await screen.findByText("No notifications found.")).toBeInTheDocument();
    expect(screen.queryByText("Create System Announcement")).not.toBeInTheDocument();
  });

  it("shows archived notifications and restores them by public reference", async () => {
    setStoredAuthToken(createUnsignedBrowserToken({
      role: "Warehouse Staff",
      exp: Math.floor(Date.now() / 1000) + 60
    }));

    let restored = false;
    const archivedNotification = {
      public_reference: "NTF-2026-ARCH1",
      notification_type: "warehouse_alert",
      title: "Archived cargo notice",
      message: "Cargo notification was archived after completion.",
      priority: "normal",
      status: "dismissed",
      is_read: true,
      created_at: "2026-06-26T11:00:00.000Z",
      archived_at: "2026-06-27T11:00:00.000Z"
    };

    const fetchMock = vi.fn(async (input, options = {}) => {
      const url = String(input);

      if (url.endsWith("/notifications/summary")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { active: restored ? 1 : 0, unread: 0, archived: restored ? 0 : 1 }
          })
        };
      }

      if (url.includes("/notifications/NTF-2026-ARCH1/restore") && options.method === "PATCH") {
        restored = true;
        return {
          ok: true,
          json: async () => ({ success: true, data: { ...archivedNotification, archived_at: null } })
        };
      }

      if (url.includes("/notifications?")) {
        const isArchivedQuery = url.includes("archived=true");
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: isArchivedQuery && !restored ? [archivedNotification] : []
          })
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Archived/i }));
    expect(await screen.findByText("Archived cargo notice")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("archived=true"),
      expect.any(Object)
    );

    fireEvent.click(screen.getByRole("button", { name: /Restore/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/notifications/NTF-2026-ARCH1/restore"),
        expect.objectContaining({ method: "PATCH" })
      );
    });
    expect(await screen.findByText("No archived notifications.")).toBeInTheDocument();
  });

  it("loads specific announcement users from backend role and warehouse filters", async () => {
    setStoredAuthToken(createUnsignedBrowserToken({
      role: "System Admin",
      exp: Math.floor(Date.now() / 1000) + 60
    }));

    const fetchMock = vi.fn(async (input) => {
      const url = String(input);

      if (url.endsWith("/notifications/summary")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { active: 0, unread: 0, archived: 0 } })
        };
      }

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

    expect(await screen.findByRole("button", { name: "Create Announcement" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Announcement" }));
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
